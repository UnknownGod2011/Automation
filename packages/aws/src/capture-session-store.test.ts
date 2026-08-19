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
  it("creates capture metadata conditionally and uses strongly consistent reads", async () => {
    const client = new FakeClient();
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");
    await store.putStarted(record);
    client.responses.push(item(record));
    await expect(store.get(scope, "capture-1")).resolves.toEqual(record);
    expect(client.commands[0]?.constructor.name).toBe("PutCommand");
    expect(client.commands[1]?.constructor.name).toBe("GetCommand");
    expect((client.commands[1] as { input?: { ConsistentRead?: boolean } }).input?.ConsistentRead).toBe(true);
  });

  it("atomically commits completion and the latest-trace pointer", async () => {
    const client = new FakeClient();
    client.responses.push(item(record), {});
    const store = new AwsDynamoCaptureSessionStore(client, "state-table");
    await expect(store.complete(scope, "capture-1", "trace-1", "2026-08-20T00:10:00.000Z")).resolves.toBe("COMPLETED");
    expect(client.commands[1]?.constructor.name).toBe("TransactWriteCommand");
    const transaction = client.commands[1] as { input?: { TransactItems?: unknown[] } };
    expect(transaction.input?.TransactItems).toHaveLength(2);
  });

  it("classifies a lost conditional race as replay only for the same trace", async () => {
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
