import { describe, expect, it } from "vitest";
import type { CaptureCollectionControlRecord } from "@automation/core";
import {
  AwsDynamoCaptureCollectionControlStore,
  type CaptureControlDynamoClientLike,
} from "./capture-control.js";

const scope = { tenantId: "tenant-a", userId: "user-a" };
const record: CaptureCollectionControlRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "automation-a",
  captureSessionId: "capture-a",
  phase: "AUTH_SETUP",
  finishRequested: false,
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function conditionalFailure(): Error {
  return Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
}

class FakeClient implements CaptureControlDynamoClientLike {
  readonly inputs: Record<string, unknown>[] = [];
  readonly responses: Array<Record<string, unknown> | Error> = [];

  async send(command: { input?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    this.inputs.push(command.input ?? {});
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }
}

describe("AwsDynamoCaptureCollectionControlStore", () => {
  it("creates capture control state with a create-only write", async () => {
    const client = new FakeClient();
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await store.putInitial(record);
    expect(client.inputs[0]).toMatchObject({
      TableName: "state-table",
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      Item: { entity: "CaptureCollectionControl", record },
    });
  });

  it("reads state strongly consistently and revalidates ownership", async () => {
    const client = new FakeClient();
    client.responses.push({ Item: { entity: "CaptureCollectionControl", record } });
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.getState(scope, "capture-a")).resolves.toEqual({ phase: "AUTH_SETUP", finishRequested: false });
    expect(client.inputs[0]).toMatchObject({ ConsistentRead: true });
  });

  it("classifies concurrent start-workflow delivery as replay only after a strong read", async () => {
    const client = new FakeClient();
    client.responses.push(
      conditionalFailure(),
      { Item: { entity: "CaptureCollectionControl", record: { ...record, phase: "WORKFLOW" } } },
    );
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.startWorkflow(scope, "capture-a", "2026-08-21T00:01:00.000Z")).resolves.toBe("REPLAY");
    expect(client.inputs).toHaveLength(2);
    expect(client.inputs[1]).toMatchObject({ ConsistentRead: true });
  });

  it("does not allow finish before WORKFLOW phase", async () => {
    const client = new FakeClient();
    client.responses.push(conditionalFailure(), { Item: { entity: "CaptureCollectionControl", record } });
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.requestFinish(scope, "capture-a", "2026-08-21T00:02:00.000Z")).rejects.toThrow(/must start/);
  });

  it("propagates DynamoDB uncertainty instead of manufacturing a replay", async () => {
    const client = new FakeClient();
    client.responses.push(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.startWorkflow(scope, "capture-a", "2026-08-21T00:01:00.000Z")).rejects.toThrow("throttled");
    expect(client.inputs).toHaveLength(1);
  });
});
