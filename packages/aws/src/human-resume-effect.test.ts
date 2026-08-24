import { describe, expect, it } from "vitest";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { HumanResumeEffectIdentity } from "@automation/core";
import {
  AwsDynamoHumanResumeEffectReconciliationStore,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";

function conditionalError(): Error {
  return Object.assign(new Error("conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });
}

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly commands: Array<GetCommand | PutCommand | UpdateCommand> = [];

  async send(
    command: Parameters<DynamoDocumentClientLike["send"]>[0],
  ): Promise<Record<string, unknown>> {
    if (command instanceof PutCommand) {
      this.commands.push(command);
      const item = command.input.Item as Record<string, unknown>;
      const key = keyOf(item);
      if (this.items.has(key)) throw conditionalError();
      this.items.set(key, structuredClone(item));
      return {};
    }

    if (command instanceof GetCommand) {
      this.commands.push(command);
      const item = this.items.get(keyOf(command.input.Key as Record<string, unknown>));
      return item ? { Item: structuredClone(item) } : {};
    }

    if (command instanceof UpdateCommand) {
      this.commands.push(command);
      const key = keyOf(command.input.Key as Record<string, unknown>);
      const item = this.items.get(key);
      const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
      if (
        !item ||
        item.entity !== values[":entity"] ||
        item.state !== values[":prepared"] ||
        item.effectId !== values[":effectId"] ||
        item.resolutionId !== values[":resolutionId"] ||
        item.successorNodeId !== values[":successorNodeId"]
      ) {
        throw conditionalError();
      }
      item.state = values[":decided"];
      item.record = structuredClone(values[":record"]);
      this.items.set(key, item);
      return {};
    }

    throw new Error(`unsupported DynamoDB command ${command.constructor.name}`);
  }
}

const config: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};

const identity = (overrides: Partial<HumanResumeEffectIdentity> = {}): HumanResumeEffectIdentity => ({
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  humanNodeId: "human-1",
  successorNodeId: "click-1",
  resolutionId: "resolution-1",
  effectId: "effect-1",
  ...overrides,
});

describe("AwsDynamoHumanResumeEffectReconciliationStore", () => {
  it("atomically prepares one effect identity and strongly reads the winner", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeEffectReconciliationStore(client, config);

    expect(await store.prepare(identity(), "2026-08-19T02:00:00.000Z")).toMatchObject({
      status: "PREPARED",
    });
    expect(await store.prepare(identity(), "2026-08-19T02:00:01.000Z")).toMatchObject({
      status: "REPLAY",
    });

    const read = client.commands.at(-1);
    expect(read).toBeInstanceOf(GetCommand);
    if (!(read instanceof GetCommand)) throw new Error("expected GetCommand");
    expect(read.input.ConsistentRead).toBe(true);
  });

  it("rejects a competing effect identity for the same durable pause boundary", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeEffectReconciliationStore(client, config);
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    const conflict = await store.prepare(
      identity({ effectId: "effect-2" }),
      "2026-08-19T02:00:01.000Z",
    );
    expect(conflict).toMatchObject({ status: "CONFLICT", record: { effectId: "effect-1" } });
  });

  it("atomically fixes one reconciliation decision and replays only the same decision", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeEffectReconciliationStore(client, config);
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    expect(
      await store.decide(identity(), "AMBIGUOUS", "2026-08-19T02:00:02.000Z"),
    ).toMatchObject({ status: "DECIDED", record: { decision: "AMBIGUOUS" } });
    expect(
      await store.decide(identity(), "AMBIGUOUS", "2026-08-19T02:00:03.000Z"),
    ).toMatchObject({ status: "REPLAY" });
    expect(
      await store.decide(identity(), "DEFINITELY_NOT_APPLIED", "2026-08-19T02:00:04.000Z"),
    ).toMatchObject({ status: "CONFLICT", record: { decision: "AMBIGUOUS" } });
  });

  it("isolates records by tenant/user partition", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeEffectReconciliationStore(client, config);
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    expect(await store.get({ tenantId: "tenant-2", userId: "user-1" }, "run-1", "human-1")).toBeNull();
    expect(await store.get({ tenantId: "tenant-1", userId: "user-2" }, "run-1", "human-1")).toBeNull();
    expect(await store.get({ tenantId: "tenant-1", userId: "user-1" }, "run-1", "human-1")).toMatchObject({
      effectId: "effect-1",
    });
  });

  it("propagates non-conditional DynamoDB uncertainty instead of guessing", async () => {
    const failing: DynamoDocumentClientLike = {
      async send() {
        throw Object.assign(new Error("throttled"), {
          name: "ProvisionedThroughputExceededException",
        });
      },
    };
    const store = new AwsDynamoHumanResumeEffectReconciliationStore(failing, config);

    await expect(store.prepare(identity(), "2026-08-19T02:00:00.000Z")).rejects.toThrow(/throttled/);
  });
});
