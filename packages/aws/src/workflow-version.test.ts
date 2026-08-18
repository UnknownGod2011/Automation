import { describe, expect, it } from "vitest";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { WorkflowGraph } from "@automation/contracts";
import {
  AwsWorkflowVersionRepository,
  canonicalWorkflowBytes,
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

function graph(version = 1): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: `wf-${version}`,
    automationId: "auto-1",
    version,
    entryNodeId: "navigate",
    objective: "Open report",
    createdAt: "2026-08-18T00:00:00.000Z",
    nodes: {
      navigate: {
        id: "navigate",
        kind: "NAVIGATE",
        objective: "Open report",
        deterministicStrategies: [
          { kind: "URL", value: "https://example.com/report" },
        ],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 2,
          initialBackoffMs: 100,
          maxBackoffMs: 1_000,
          jitter: true,
          retryableFailureCodes: ["TRANSIENT_NETWORK"],
        },
        timeoutMs: 10_000,
        next: ["end"],
        escalation: "SEMANTIC_RECOVERY",
      },
      end: {
        id: "end",
        kind: "END",
        objective: "Finish",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: false,
          retryableFailureCodes: [],
        },
        timeoutMs: 1_000,
        escalation: "FAIL",
      },
    },
  };
}

function repository() {
  const dynamo = new FakeMetadataDynamo();
  const documents = new FakeDocuments();
  return {
    dynamo,
    documents,
    value: new AwsWorkflowVersionRepository(
      dynamo,
      dynamoConfig,
      documents,
      artifactConfig,
    ),
  };
}

describe("canonicalWorkflowBytes", () => {
  it("is stable across object key insertion order", () => {
    const first = graph();
    const second: WorkflowGraph = {
      ...first,
      nodes: {
        end: first.nodes.end!,
        navigate: first.nodes.navigate!,
      },
    };
    expect(canonicalWorkflowBytes(first)).toEqual(canonicalWorkflowBytes(second));
  });
});

describe("AwsWorkflowVersionRepository", () => {
  it("stores immutable metadata in DynamoDB and the canonical graph in S3", async () => {
    const { value, documents } = repository();
    const original = graph(1);

    await value.putImmutable(scope, original);
    expect(await value.get(scope, "auto-1", 1)).toEqual(original);
    expect(documents.puts).toHaveLength(1);
    expect(documents.puts[0]).not.toContain(scope.tenantId);
    expect(documents.puts[0]).not.toContain(scope.userId);
  });

  it("rejects overwriting a published workflow version", async () => {
    const { value } = repository();
    await value.putImmutable(scope, graph(1));
    await expect(value.putImmutable(scope, graph(1))).rejects.toThrow(/already exists/);
  });

  it("recovers safely when S3 succeeded but the metadata write transiently failed", async () => {
    const { value, dynamo, documents } = repository();
    dynamo.failNextPut = Object.assign(new Error("temporary DynamoDB outage"), {
      name: "InternalServerError",
    });

    await expect(value.putImmutable(scope, graph(1))).rejects.toThrow(/temporary DynamoDB outage/);
    expect(documents.objects.size).toBe(1);

    await expect(value.putImmutable(scope, graph(1))).resolves.toBeUndefined();
    expect(await value.get(scope, "auto-1", 1)).toEqual(graph(1));
    expect(documents.objects.size).toBe(1);
  });

  it("detects a conflicting orphan S3 document instead of attaching wrong metadata", async () => {
    const { value, documents } = repository();
    const expected = graph(1);
    await expect(value.putImmutable(scope, expected)).resolves.toBeUndefined();

    const { value: freshMetadataRepository, documents: conflictingDocuments } = repository();
    const key = [...documents.objects.keys()][0];
    if (!key) throw new Error("expected workflow object key");
    conflictingDocuments.objects.set(
      key,
      canonicalWorkflowBytes({ ...expected, workflowId: "different-workflow" }),
    );

    await expect(
      freshMetadataRepository.putImmutable(scope, expected),
    ).rejects.toThrow(/conflicts with an existing immutable S3 document/);
  });

  it("lists immutable versions in numeric order", async () => {
    const { value } = repository();
    await value.putImmutable(scope, graph(2));
    await value.putImmutable(scope, graph(1));

    expect((await value.list(scope, "auto-1")).map((item) => item.version)).toEqual([
      1,
      2,
    ]);
  });

  it("does not resolve workflow metadata from another ownership partition", async () => {
    const { value } = repository();
    await value.putImmutable(scope, graph(1));
    expect(
      await value.get({ tenantId: "tenant-2", userId: "user-2" }, "auto-1", 1),
    ).toBeNull();
  });
});
