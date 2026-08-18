import { describe, expect, it } from "vitest";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AutomationRecord, RunCheckpoint, RunRecord } from "@automation/contracts";
import {
  AwsDynamoAutomationLockManager,
  AwsDynamoAutomationRepository,
  AwsDynamoCheckpointRepository,
  AwsDynamoDbConfigurationPreflightCheck,
  AwsDynamoRunRepository,
  loadAwsDynamoDbConfig,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";

function conditionalError(name = "ConditionalCheckFailedException"): Error {
  return Object.assign(new Error("conditional request failed"), { name });
}

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();

  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (command instanceof GetCommand) {
      const key = command.input.Key as Record<string, unknown>;
      const item = this.items.get(keyOf(key));
      return item ? { Item: structuredClone(item) } : {};
    }

    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      const existing = this.items.get(keyOf(item));
      const condition = command.input.ConditionExpression;

      if (condition?.includes("attribute_not_exists") && existing) {
        const now = Number(command.input.ExpressionAttributeValues?.[":now"]);
        const owner = command.input.ExpressionAttributeValues?.[":ownerToken"];
        const expired = Number(existing.expiresAtEpochMs) <= now;
        const sameOwner = existing.ownerToken === owner;
        if (!expired && !sameOwner) throw conditionalError();
      }

      if (condition?.includes("attribute_exists") && !condition.includes("attribute_not_exists")) {
        if (!existing) throw conditionalError();
        const values = command.input.ExpressionAttributeValues ?? {};
        if (
          existing.entity !== values[":entity"] ||
          existing.automationId !== values[":automationId"] ||
          existing.workflowVersion !== values[":workflowVersion"] ||
          existing.occurrenceKey !== values[":occurrenceKey"]
        ) {
          throw conditionalError();
        }
      }

      this.items.set(keyOf(item), structuredClone(item));
      return {};
    }

    if (command instanceof TransactWriteCommand) {
      const puts = (command.input.TransactItems ?? []).map((entry) => entry.Put).filter(Boolean);
      for (const put of puts) {
        const item = put?.Item as Record<string, unknown>;
        if (this.items.has(keyOf(item))) {
          throw conditionalError("TransactionCanceledException");
        }
      }
      for (const put of puts) {
        const item = put?.Item as Record<string, unknown>;
        this.items.set(keyOf(item), structuredClone(item));
      }
      return {};
    }

    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues ?? {};
      let items = [...this.items.values()];
      if (command.input.IndexName) {
        items = items
          .filter((item) => item.gsi1pk === values[":pk"])
          .sort((a, b) => String(a.gsi1sk).localeCompare(String(b.gsi1sk)));
      } else {
        items = items.filter(
          (item) =>
            item.pk === values[":pk"] &&
            String(item.sk).startsWith(String(values[":prefix"])),
        );
      }
      return { Items: structuredClone(items) };
    }

    if (command instanceof UpdateCommand) {
      const key = command.input.Key as Record<string, unknown>;
      const existing = this.items.get(keyOf(key));
      const values = command.input.ExpressionAttributeValues ?? {};
      const now = Number(values[":now"]);
      if (
        !existing ||
        existing.entity !== values[":entity"] ||
        existing.ownerToken !== values[":ownerToken"] ||
        Number(existing.expiresAtEpochMs) <= now
      ) {
        throw conditionalError();
      }
      const updated = {
        ...existing,
        expiresAt: values[":expiresAt"],
        expiresAtEpochMs: values[":expiresAtEpochMs"],
        ttl: values[":ttl"],
      };
      this.items.set(keyOf(key), structuredClone(updated));
      return { Attributes: structuredClone(updated) };
    }

    if (command instanceof DeleteCommand) {
      const key = command.input.Key as Record<string, unknown>;
      const existing = this.items.get(keyOf(key));
      const values = command.input.ExpressionAttributeValues ?? {};
      if (
        !existing ||
        existing.entity !== values[":entity"] ||
        existing.ownerToken !== values[":ownerToken"]
      ) {
        throw conditionalError();
      }
      this.items.delete(keyOf(key));
      return {};
    }

    throw new Error(`unsupported DynamoDB command ${command.constructor.name}`);
  }
}

const config: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};
const scope = { tenantId: "tenant-1", userId: "user-1" };

function automation(id = "auto-1"): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: id,
    name: "Daily report",
    websiteUrl: "https://example.com",
    prompt: "Open report",
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    browserProfileRef: "profile://1",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

function run(runId: string, occurrenceKey: string, scheduledAt = "2026-08-18T12:00:00.000Z"): RunRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId,
    automationId: "auto-1",
    workflowVersion: 1,
    occurrenceKey,
    status: "QUEUED",
    scheduledAt,
  };
}

describe("AwsDynamoAutomationRepository", () => {
  it("stores and lists only records in the requested ownership partition", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoAutomationRepository(client, config);
    await repository.put(automation("auto-1"));
    await repository.put({
      ...automation("auto-2"),
      tenantId: "tenant-2",
      userId: "user-2",
    });

    expect((await repository.list(scope)).map((item) => item.automationId)).toEqual(["auto-1"]);
    expect(await repository.get(scope, "auto-1")).toMatchObject({ automationId: "auto-1" });
    expect(await repository.get(scope, "auto-2")).toBeNull();
  });
});

describe("AwsDynamoRunRepository", () => {
  it("deduplicates the same scheduled occurrence atomically", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoRunRepository(client, config);
    const first = await repository.createIfAbsent(run("run-1", "occurrence-1"));
    const duplicate = await repository.createIfAbsent(run("run-2", "occurrence-1"));

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.run.runId).toBe("run-1");
  });

  it("rejects reusing a run id for a distinct occurrence", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoRunRepository(client, config);
    await repository.createIfAbsent(run("run-1", "occurrence-1"));

    await expect(
      repository.createIfAbsent(run("run-1", "occurrence-2")),
    ).rejects.toThrow(/already exists with another occurrence/);
  });

  it("preserves immutable identity fields during updates", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoRunRepository(client, config);
    const original = run("run-1", "occurrence-1");
    await repository.createIfAbsent(original);
    await repository.update({ ...original, status: "PREFLIGHT" });
    expect((await repository.get(scope, "run-1"))?.status).toBe("PREFLIGHT");

    await expect(
      repository.update({ ...original, automationId: "other" }),
    ).rejects.toThrow(/immutable run identity/);
  });

  it("queries runs by automation through the configured index in schedule order", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoRunRepository(client, config);
    await repository.createIfAbsent(run("run-2", "occurrence-2", "2026-08-18T13:00:00.000Z"));
    await repository.createIfAbsent(run("run-1", "occurrence-1", "2026-08-18T12:00:00.000Z"));

    expect((await repository.listForAutomation(scope, "auto-1")).map((item) => item.runId)).toEqual([
      "run-1",
      "run-2",
    ]);
  });
});

describe("AwsDynamoCheckpointRepository", () => {
  it("keeps durable checkpoints isolated by ownership partition", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoCheckpointRepository(client, config);
    const checkpoint: RunCheckpoint = {
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 1,
      currentNodeId: "node-1",
      completedNodeIds: [],
      attempt: 1,
      fingerprintRepeatCount: 0,
      variables: { report: "R-1" },
      evidenceRefs: [],
      updatedAt: "2026-08-18T12:00:00.000Z",
    };
    await repository.put(scope, checkpoint);

    expect(await repository.get(scope, "run-1")).toEqual(checkpoint);
    expect(
      await repository.get({ tenantId: "tenant-2", userId: "user-2" }, "run-1"),
    ).toBeNull();
  });
});

describe("AwsDynamoAutomationLockManager", () => {
  it("prevents concurrent owners, renews live leases, and allows takeover after expiry", async () => {
    const client = new FakeDynamo();
    let nowMs = Date.parse("2026-08-18T12:00:00.000Z");
    const locks = new AwsDynamoAutomationLockManager(client, config, () => new Date(nowMs));

    const first = await locks.acquire(scope, "auto-1", "run-1", 1_000);
    expect(first).not.toBeNull();
    expect(await locks.acquire(scope, "auto-1", "run-2", 1_000)).toBeNull();
    if (!first) throw new Error("expected first lease");

    nowMs += 500;
    const renewed = await locks.renew(scope, first, 2_000);
    expect(renewed?.expiresAt).toBe("2026-08-18T12:00:02.500Z");

    nowMs += 2_001;
    expect(await locks.renew(scope, renewed ?? first, 1_000)).toBeNull();
    expect(await locks.acquire(scope, "auto-1", "run-2", 1_000)).not.toBeNull();
  });

  it("does not let a different owner renew or release a live lock", async () => {
    const client = new FakeDynamo();
    const locks = new AwsDynamoAutomationLockManager(
      client,
      config,
      () => new Date("2026-08-18T12:00:00.000Z"),
    );
    const lease = await locks.acquire(scope, "auto-1", "run-1", 10_000);
    if (!lease) throw new Error("expected lease");
    const foreign = { ...lease, ownerToken: "run-2" };

    await expect(locks.renew(scope, foreign, 10_000)).rejects.toThrow(/not owned/);
    await expect(locks.release(scope, foreign)).rejects.toThrow(/not owned/);
  });
});

describe("AWS DynamoDB configuration", () => {
  it("requires an explicit table and supports a configurable automation-runs index", async () => {
    const missing = loadAwsDynamoDbConfig({});
    expect(missing.configured).toBe(false);
    const check = new AwsDynamoDbConfigurationPreflightCheck(missing);
    const blocked = await check.check();
    expect(blocked.ready).toBe(false);

    const configured = loadAwsDynamoDbConfig({
      AWS_DYNAMODB_TABLE: "automation-prod-state",
      AWS_DYNAMODB_AUTOMATION_RUNS_INDEX: "automation-runs",
    });
    expect(configured).toEqual({
      configured: true,
      config: {
        tableName: "automation-prod-state",
        automationRunsIndexName: "automation-runs",
      },
    });
  });
});
