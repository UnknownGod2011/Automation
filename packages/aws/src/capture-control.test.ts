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
  collectorReady: false,
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
  it("creates capture control state with a create-only not-ready write", async () => {
    const client = new FakeClient();
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await store.putInitial(record);
    expect(client.inputs[0]).toMatchObject({
      TableName: "state-table",
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      Item: { entity: "CaptureCollectionControl", record },
    });
  });

  it("reads readiness strongly consistently and revalidates ownership", async () => {
    const client = new FakeClient();
    client.responses.push({ Item: { entity: "CaptureCollectionControl", record } });
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.getState(scope, "capture-a")).resolves.toEqual({
      phase: "AUTH_SETUP",
      finishRequested: false,
      collectorReady: false,
    });
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

  it("durably marks collector readiness and classifies exact contention as replay", async () => {
    const client = new FakeClient();
    client.responses.push(
      conditionalFailure(),
      { Item: { entity: "CaptureCollectionControl", record: { ...record, phase: "WORKFLOW", collectorReady: true } } },
    );
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.markReady(scope, "capture-a", "2026-08-21T00:01:30.000Z"))
      .resolves.toBe("REPLAY");
    expect(client.inputs[0]).toMatchObject({
      UpdateExpression: expect.stringContaining("#record.#ready = :true"),
      ConditionExpression: expect.stringContaining("#record.#phase = :workflow"),
    });
    expect(client.inputs[1]).toMatchObject({ ConsistentRead: true });
  });

  it("does not allow finish before WORKFLOW phase", async () => {
    const client = new FakeClient();
    client.responses.push(conditionalFailure(), { Item: { entity: "CaptureCollectionControl", record } });
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.requestFinish(scope, "capture-a", "2026-08-21T00:02:00.000Z")).rejects.toThrow(/must start/);
  });

  it("does not allow finish before the collector is ready", async () => {
    const client = new FakeClient();
    client.responses.push(
      conditionalFailure(),
      { Item: { entity: "CaptureCollectionControl", record: { ...record, phase: "WORKFLOW", collectorReady: false } } },
    );
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.requestFinish(scope, "capture-a", "2026-08-21T00:02:00.000Z"))
      .rejects.toThrow("collector is not ready");
    expect(client.inputs[0]).toMatchObject({
      ConditionExpression: expect.stringContaining("#record.#ready = :true"),
    });
  });

  it("propagates DynamoDB uncertainty instead of manufacturing a replay", async () => {
    const client = new FakeClient();
    client.responses.push(Object.assign(new Error("throttled"), { name: "ThrottlingException" }));
    const store = new AwsDynamoCaptureCollectionControlStore(client, "state-table");
    await expect(store.startWorkflow(scope, "capture-a", "2026-08-21T00:01:00.000Z")).rejects.toThrow("throttled");
    expect(client.inputs).toHaveLength(1);
  });
});
