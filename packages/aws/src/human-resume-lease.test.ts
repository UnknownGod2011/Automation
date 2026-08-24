import { describe, expect, it } from "vitest";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  AwsDynamoHumanResumeExecutionLeaseStore,
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
      const existing = this.items.get(key);
      if (existing) {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        const sameResolution = existing.resolutionId === values[":resolutionId"];
        const active = existing.state === "ACTIVE";
        const expired = Number(existing.expiresAtEpochMs) <= Number(values[":now"]);
        if (!(sameResolution && active && expired)) throw conditionalError();
      }
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
        item.resolutionId !== values[":resolutionId"] ||
        item.ownerToken !== values[":ownerToken"] ||
        item.state !== "ACTIVE" ||
        Number(item.expiresAtEpochMs) <= Number(values[":now"])
      ) {
        throw conditionalError();
      }
      if (values[":newExpiry"] !== undefined) item.expiresAtEpochMs = values[":newExpiry"];
      if (values[":completed"] !== undefined) item.state = values[":completed"];
      item.lease = structuredClone(values[":lease"]);
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
const scope = { tenantId: "tenant-1", userId: "user-1" };
const command = (resolutionId = "resolution-1") => ({
  scope,
  runId: "run-1",
  expectedNodeId: "human-1",
  resolutionId,
});

describe("AwsDynamoHumanResumeExecutionLeaseStore", () => {
  it("conditionally acquires one execution owner", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(client, config);

    const first = await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 30_000);
    const second = await store.acquire(command(), "worker-b", "2026-08-19T00:00:01.000Z", 30_000);

    expect(first).toMatchObject({ status: "ACQUIRED", lease: { ownerToken: "worker-a" } });
    expect(second).toMatchObject({ status: "BUSY", lease: { ownerToken: "worker-a" } });
    const read = client.commands.at(-1);
    expect(read).toBeInstanceOf(GetCommand);
    if (!(read instanceof GetCommand)) throw new Error("expected GetCommand");
    expect(read.input.ConsistentRead).toBe(true);
  });

  it("allows only the accepted resolution id to reacquire after expiry", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(client, config);
    await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 1_000);

    const conflict = await store.acquire(
      command("resolution-2"),
      "worker-b",
      "2026-08-19T00:00:02.000Z",
      1_000,
    );
    const recovered = await store.acquire(
      command(),
      "worker-c",
      "2026-08-19T00:00:02.000Z",
      1_000,
    );

    expect(conflict.status).toBe("CONFLICT");
    expect(recovered).toMatchObject({ status: "ACQUIRED", lease: { ownerToken: "worker-c" } });
  });

  it("renews live ownership and persists a completed tombstone", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(client, config);
    const acquired = await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 5_000);
    if (acquired.status !== "ACQUIRED") throw new Error("expected acquisition");

    const renewed = await store.renew(acquired.lease, "2026-08-19T00:00:02.000Z", 5_000);
    expect(renewed?.expiresAt).toBe("2026-08-19T00:00:07.000Z");
    if (!renewed) throw new Error("expected renewal");

    const completed = await store.complete(renewed, "2026-08-19T00:00:03.000Z");
    expect(completed).toMatchObject({ state: "COMPLETED" });
    expect(await store.acquire(command(), "worker-b", "2026-08-19T00:00:20.000Z", 5_000)).toMatchObject({
      status: "COMPLETED",
    });
  });

  it("rejects stale completion after lease expiry", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(client, config);
    const acquired = await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 1_000);
    if (acquired.status !== "ACQUIRED") throw new Error("expected acquisition");

    expect(await store.complete(acquired.lease, "2026-08-19T00:00:01.000Z")).toBeNull();
  });

  it("isolates execution leases by tenant and user", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(client, config);
    await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 30_000);

    expect(await store.get({ tenantId: "tenant-2", userId: "user-2" }, "run-1", "human-1")).toBeNull();
    expect(await store.get(scope, "run-1", "human-1")).toMatchObject({ ownerToken: "worker-a" });
  });

  it("propagates non-conditional DynamoDB uncertainty", async () => {
    const failing: DynamoDocumentClientLike = {
      async send() {
        throw Object.assign(new Error("throttled"), {
          name: "ProvisionedThroughputExceededException",
        });
      },
    };
    const store = new AwsDynamoHumanResumeExecutionLeaseStore(failing, config);

    await expect(
      store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 30_000),
    ).rejects.toThrow(/throttled/);
  });
});
