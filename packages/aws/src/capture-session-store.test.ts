import { describe, expect, it } from "vitest";
import type { CaptureSessionRecord } from "@automation/core";
import { AwsDynamoCaptureSessionStore, type CaptureDynamoClientLike } from "./capture-session-store.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const record: CaptureSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  captureSessionId: "capture-1",
  browserSessionId: "browser-1",
  browserProfileRef: "profile-1",
  startedAt: "2026-08-20T00:00:00.000Z",
  expiresAt: "2026-08-20T01:00:00.000Z",
  status: "STARTED",
};

type CaptureDynamoCommand = Parameters<CaptureDynamoClientLike["send"]>[0];

class FakeClient implements CaptureDynamoClientLike {
  readonly commands: CaptureDynamoCommand[] = [];
  readonly responses: (Record<string, unknown> | Error)[] = [];
  async send(command: CaptureDynamoCommand) {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response ?? {};
  }
}

function item(value: CaptureSessionRecord): Record<string, unknown> {
  return { Item: { entity: "CaptureSession", record: structuredClone(value) } };
}

describe("AwsDynamoCaptureSessionStore", () => {
  it("atomically creates capture metadata with a guarded current-capture pointer and uses strongly consistent reads", async () => {
    const client = new FakeClient();
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");
    await store.putStarted(record);
    client.responses.push(item(record));
    await expect(store.get(scope, "capture-1")).resolves.toEqual(record);
    expect(client.commands[0]?.constructor.name).toBe("TransactWriteCommand");
    const created = client.commands[0] as { input?: { TransactItems?: Array<{ Put?: { Item?: Record<string, unknown>; ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } }> } };
    expect(created.input?.TransactItems).toHaveLength(2);
    const current = created.input?.TransactItems?.[1]?.Put;
    expect(current?.Item).toMatchObject({ captureSessionId: "capture-1", expiresAt: record.expiresAt });
    expect(current?.ConditionExpression).toContain("expiresAt <= :startedAt");
    expect(current?.ExpressionAttributeValues).toEqual({ ":startedAt": record.startedAt });
    expect(client.commands[1]?.constructor.name).toBe("GetCommand");
    expect((client.commands[1] as { input?: { ConsistentRead?: boolean } }).input?.ConsistentRead).toBe(true);
  });

  it("resolves only the current STARTED capture and keeps browser/profile fields behind the store boundary", async () => {
    const client = new FakeClient();
    client.responses.push(
      { Item: { entity: "CaptureSessionCurrent", automationId: "auto-1", captureSessionId: "capture-1", expiresAt: record.expiresAt } },
      item(record),
    );
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");

    await expect(store.activeForAutomation(scope, "auto-1")).resolves.toEqual(record);
    expect(client.commands).toHaveLength(2);
    expect((client.commands[0] as { input?: { ConsistentRead?: boolean } }).input?.ConsistentRead).toBe(true);
    expect((client.commands[1] as { input?: { ConsistentRead?: boolean } }).input?.ConsistentRead).toBe(true);
  });

  it("returns no active capture when the current pointer resolves to a completed session", async () => {
    const client = new FakeClient();
    client.responses.push(
      { Item: { entity: "CaptureSessionCurrent", automationId: "auto-1", captureSessionId: "capture-1", expiresAt: record.expiresAt } },
      item({ ...record, status: "COMPLETED", traceId: "trace-1", completedAt: "2026-08-20T00:10:00.000Z" }),
    );
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");

    await expect(store.activeForAutomation(scope, "auto-1")).resolves.toBeNull();
  });

  it("atomically cancels the active session and releases only its exact current-capture claim", async () => {
    const client = new FakeClient();
    client.responses.push(item(record), {});
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");

    await expect(store.cancel(scope, "capture-1", "2026-08-20T00:08:00.000Z")).resolves.toBe("CANCELED");
    const transaction = client.commands[1] as { input?: { TransactItems?: Array<{ Put?: { Item?: Record<string, unknown> }; Delete?: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } }> } };
    expect(transaction.input?.TransactItems).toHaveLength(2);
    expect(transaction.input?.TransactItems?.[0]?.Put?.Item).toMatchObject({
      record: expect.objectContaining({ status: "CANCELED", canceledAt: "2026-08-20T00:08:00.000Z" }),
    });
    expect(transaction.input?.TransactItems?.[1]?.Delete?.ConditionExpression).toBe("captureSessionId = :captureSessionId");
    expect(transaction.input?.TransactItems?.[1]?.Delete?.ExpressionAttributeValues).toEqual({ ":captureSessionId": "capture-1" });
  });

  it("classifies a lost conditional cancellation race as replay only for a canceled winner", async () => {
    const client = new FakeClient();
    const conditional = Object.assign(new Error("lost race"), { name: "TransactionCanceledException" });
    client.responses.push(
      item(record),
      conditional,
      item({ ...record, status: "CANCELED", canceledAt: "2026-08-20T00:08:00.000Z" }),
    );
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");

    await expect(store.cancel(scope, "capture-1", "2026-08-20T00:08:00.000Z")).resolves.toBe("REPLAY");
  });

  it("atomically commits completion, latest-trace pointer, and release of the exact current-capture claim", async () => {
    const client = new FakeClient();
    client.responses.push(item(record), {});
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");
    await expect(store.complete(scope, "capture-1", "trace-1", "2026-08-20T00:10:00.000Z")).resolves.toBe("COMPLETED");
    expect(client.commands[1]?.constructor.name).toBe("TransactWriteCommand");
    const transaction = client.commands[1] as { input?: { TransactItems?: Array<{ Delete?: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } }> } };
    expect(transaction.input?.TransactItems).toHaveLength(3);
    const release = transaction.input?.TransactItems?.[2]?.Delete;
    expect(release?.ConditionExpression).toBe("captureSessionId = :captureSessionId");
    expect(release?.ExpressionAttributeValues).toEqual({ ":captureSessionId": "capture-1" });
  });

  it("classifies a lost conditional completion race as replay only for the same trace", async () => {
    const client = new FakeClient();
    const conditional = Object.assign(new Error("lost race"), { name: "TransactionCanceledException" });
    client.responses.push(
      item(record),
      conditional,
      item({ ...record, status: "COMPLETED", traceId: "trace-1", completedAt: "2026-08-20T00:10:00.000Z" }),
    );
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");
    await expect(store.complete(scope, "capture-1", "trace-1", "2026-08-20T00:10:00.000Z")).resolves.toBe("REPLAY");
  });
});
