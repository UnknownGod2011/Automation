import { describe, expect, it } from "vitest";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CaptureTrace } from "@automation/contracts";
import {
  AwsCaptureTraceRepository,
  canonicalCaptureTraceBytes,
  type AwsArtifactStoreConfig,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
  type S3WorkflowDocumentApi,
} from "./index.js";

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeMetadataDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();
  failNextPut: Error | null = null;

  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (command instanceof GetCommand) {
      const key = command.input.Key as Record<string, unknown>;
      const item = this.items.get(keyOf(key));
      return item ? { Item: structuredClone(item) } : {};
    }

    if (command instanceof PutCommand) {
      if (this.failNextPut) {
        const error = this.failNextPut;
        this.failNextPut = null;
        throw error;
      }
      const item = command.input.Item as Record<string, unknown>;
      if (this.items.has(keyOf(item))) {
        throw Object.assign(new Error("already exists"), {
          name: "ConditionalCheckFailedException",
        });
      }
      this.items.set(keyOf(item), structuredClone(item));
      return {};
    }

    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues ?? {};
      const items = [...this.items.values()]
        .filter(
          (item) =>
            item.pk === values[":pk"] &&
            String(item.sk).startsWith(String(values[":prefix"])),
        )
        .sort((left, right) => String(left.sk).localeCompare(String(right.sk)));
      return { Items: structuredClone(items) };
    }

    throw new Error(`unsupported metadata command ${command.constructor.name}`);
  }
}

class FakeDocuments implements S3WorkflowDocumentApi {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: string[] = [];

  async putIfAbsent(key: string, content: Uint8Array) {
    this.puts.push(key);
    if (this.objects.has(key)) return "EXISTS" as const;
    this.objects.set(key, Uint8Array.from(content));
    return "CREATED" as const;
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value ? Uint8Array.from(value) : null;
  }
}

const scope = { tenantId: "tenant-1", userId: "user-1" };
const dynamoConfig: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};
const artifactConfig: AwsArtifactStoreConfig = {
  bucket: "automation-artifacts",
  prefix: "automation",
};

function trace(traceId = "trace-1", startedAt = "2026-08-20T10:00:00.000Z"): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    websiteUrl: "https://app.example.com/",
    objective: "Open the account and save a note",
    browserProfileRef: "profile-1",
    startedAt,
    finishedAt: "2026-08-20T10:01:00.000Z",
    events: [
      {
        eventId: "navigate",
        sequence: 1,
        kind: "NAVIGATION",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-20T10:00:10.000Z",
        page: { url: "https://app.example.com/account" },
        navigationUrl: "https://app.example.com/account",
        artifactRefs: [],
      },
    ],
  };
}

function repository() {
  const dynamo = new FakeMetadataDynamo();
  const documents = new FakeDocuments();
  return {
    dynamo,
    documents,
    value: new AwsCaptureTraceRepository(
      dynamo,
      dynamoConfig,
      documents,
      artifactConfig,
    ),
  };
}

describe("canonicalCaptureTraceBytes", () => {
  it("is stable across object key insertion order", () => {
    const first = trace();
    const second: CaptureTrace = {
      events: first.events,
      finishedAt: first.finishedAt,
      startedAt: first.startedAt,
      browserProfileRef: first.browserProfileRef,
      objective: first.objective,
      websiteUrl: first.websiteUrl,
      automationId: first.automationId,
      userId: first.userId,
      tenantId: first.tenantId,
      traceId: first.traceId,
      schemaVersion: first.schemaVersion,
    };
    expect(canonicalCaptureTraceBytes(first)).toEqual(canonicalCaptureTraceBytes(second));
  });
});

describe("AwsCaptureTraceRepository", () => {
  it("stores tenant-scoped metadata in DynamoDB and immutable trace content in S3", async () => {
    const { value, documents } = repository();
    const original = trace();

    await value.putImmutable(original);

    expect(await value.get(scope, "auto-1", "trace-1")).toEqual(original);
    expect(documents.puts).toHaveLength(1);
    expect(documents.puts[0]).not.toContain(scope.tenantId);
    expect(documents.puts[0]).not.toContain(scope.userId);
    expect(documents.puts[0]).not.toContain("trace-1");
  });

  it("rejects overwriting an existing capture trace", async () => {
    const { value } = repository();
    await value.putImmutable(trace());
    await expect(value.putImmutable(trace())).rejects.toThrow(/already exists/);
  });

  it("recovers safely when S3 succeeded but the metadata write failed", async () => {
    const { value, dynamo, documents } = repository();
    dynamo.failNextPut = Object.assign(new Error("temporary DynamoDB outage"), {
      name: "InternalServerError",
    });

    await expect(value.putImmutable(trace())).rejects.toThrow(/temporary DynamoDB outage/);
    expect(documents.objects.size).toBe(1);

    await expect(value.putImmutable(trace())).resolves.toBeUndefined();
    expect(await value.get(scope, "auto-1", "trace-1")).toEqual(trace());
    expect(documents.objects.size).toBe(1);
  });

  it("rejects a conflicting orphan S3 document", async () => {
    const { documents } = repository();
    const original = trace();
    const seeded = new AwsCaptureTraceRepository(
      new FakeMetadataDynamo(),
      dynamoConfig,
      documents,
      artifactConfig,
    );
    await seeded.putImmutable(original);
    const key = [...documents.objects.keys()][0];
    if (!key) throw new Error("expected capture object key");

    documents.objects.set(
      key,
      canonicalCaptureTraceBytes({ ...original, objective: "different objective" }),
    );
    const fresh = new AwsCaptureTraceRepository(
      new FakeMetadataDynamo(),
      dynamoConfig,
      documents,
      artifactConfig,
    );

    await expect(fresh.putImmutable(original)).rejects.toThrow(/conflicts with an existing immutable S3 document/);
  });

  it("lists traces in capture order", async () => {
    const { value } = repository();
    await value.putImmutable(trace("trace-2", "2026-08-20T11:00:00.000Z"));
    await value.putImmutable(trace("trace-1", "2026-08-20T10:00:00.000Z"));

    expect((await value.list(scope, "auto-1")).map((item) => item.traceId)).toEqual([
      "trace-1",
      "trace-2",
    ]);
  });

  it("does not resolve metadata from another ownership partition", async () => {
    const { value } = repository();
    await value.putImmutable(trace());

    expect(
      await value.get({ tenantId: "tenant-2", userId: "user-2" }, "auto-1", "trace-1"),
    ).toBeNull();
  });
});
