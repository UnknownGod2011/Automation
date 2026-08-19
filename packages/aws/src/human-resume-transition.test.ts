import { describe, expect, it } from "vitest";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import type {
  HumanResumeAlreadyAppliedTransitionRequest,
  HumanResumeEffectRecord,
  HumanResumeExecutionLease,
} from "@automation/core";
import {
  AwsDynamoHumanResumeAlreadyAppliedTransitionStore,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";

const config: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};
const scope = { tenantId: "tenant-1", userId: "user-1" };

function transactionConditionalError(): Error {
  return Object.assign(new Error("conditional transaction failed"), {
    name: "TransactionCanceledException",
    CancellationReasons: [
      { Code: "None" },
      { Code: "ConditionalCheckFailed" },
      { Code: "None" },
    ],
  });
}

function run(): RunRecord {
  return {
    ...scope,
    runId: "run-1",
    automationId: "automation-1",
    workflowVersion: 7,
    occurrenceKey: "occurrence-1",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-19T00:00:00.000Z",
    startedAt: "2026-08-19T00:00:01.000Z",
    currentNodeId: "human",
  };
}

function paused(): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "automation-1",
    workflowVersion: 7,
    currentNodeId: "human",
    completedNodeIds: ["before"],
    attempt: 2,
    fingerprintRepeatCount: 1,
    variables: {},
    evidenceRefs: [],
    updatedAt: "2026-08-19T00:01:00.000Z",
  };
}

function next(): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "automation-1",
    workflowVersion: 7,
    currentNodeId: "end",
    completedNodeIds: ["before", "human", "submit"],
    attempt: 0,
    fingerprintRepeatCount: 0,
    variables: { confirmation: "abc" },
    evidenceRefs: ["artifact://reconciled"],
    updatedAt: "2026-08-19T00:03:00.000Z",
  };
}

function effect(): HumanResumeEffectRecord {
  return {
    ...scope,
    runId: "run-1",
    humanNodeId: "human",
    successorNodeId: "submit",
    resolutionId: "resolution-1",
    effectId: "effect-1",
    state: "DECIDED",
    preparedAt: "2026-08-19T00:01:30.000Z",
    decision: "ALREADY_APPLIED",
    decidedAt: "2026-08-19T00:02:00.000Z",
  };
}

function lease(): HumanResumeExecutionLease {
  return {
    ...scope,
    runId: "run-1",
    nodeId: "human",
    resolutionId: "resolution-1",
    ownerToken: "owner-1",
    state: "ACTIVE",
    acquiredAt: "2026-08-19T00:02:10.000Z",
    expiresAt: "2026-08-19T00:10:00.000Z",
  };
}

function request(): HumanResumeAlreadyAppliedTransitionRequest {
  return {
    scope,
    effect: effect(),
    lease: lease(),
    expectedRun: run(),
    expectedCheckpoint: paused(),
    nextCheckpoint: next(),
    committedAt: "2026-08-19T00:03:01.000Z",
  };
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();
  failWith?: Error;
  lastGets: GetCommand[] = [];

  private key(key: Record<string, unknown>): string {
    return `${String(key.pk)}|${String(key.sk)}`;
  }

  seed(pk: string, sk: string, item: Record<string, unknown>): void {
    this.items.set(this.key({ pk, sk }), structuredClone({ pk, sk, ...item }));
  }

  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (this.failWith) throw this.failWith;
    if (command instanceof GetCommand) {
      this.lastGets.push(command);
      const item = this.items.get(this.key(command.input.Key as Record<string, unknown>));
      return item ? { Item: structuredClone(item) } : {};
    }
    if (!(command instanceof TransactWriteCommand)) {
      throw new Error(`unsupported command ${command.constructor.name}`);
    }

    const entries = command.input.TransactItems ?? [];
    const condition = entries[0]?.ConditionCheck;
    const runPut = entries[1]?.Put;
    const checkpointPut = entries[2]?.Put;
    if (!condition || !runPut || !checkpointPut) throw new Error("unexpected transaction shape");

    const leaseItem = this.items.get(this.key(condition.Key as Record<string, unknown>));
    const leaseValues = condition.ExpressionAttributeValues ?? {};
    if (
      !leaseItem ||
      leaseItem.entity !== leaseValues[":leaseEntity"] ||
      leaseItem.resolutionId !== leaseValues[":resolutionId"] ||
      leaseItem.ownerToken !== leaseValues[":ownerToken"] ||
      leaseItem.state !== leaseValues[":active"] ||
      Number(leaseItem.expiresAtEpochMs) <= Number(leaseValues[":now"])
    ) {
      throw transactionConditionalError();
    }

    const existingRun = this.items.get(this.key(runPut.Item as Record<string, unknown>));
    const runValues = runPut.ExpressionAttributeValues ?? {};
    const existingRunRecord = existingRun?.record as RunRecord | undefined;
    if (
      !existingRun ||
      existingRun.entity !== runValues[":runEntity"] ||
      existingRun.automationId !== runValues[":automationId"] ||
      existingRun.workflowVersion !== runValues[":workflowVersion"] ||
      existingRun.occurrenceKey !== runValues[":occurrenceKey"] ||
      existingRunRecord?.status !== runValues[":waiting"] ||
      existingRunRecord.currentNodeId !== runValues[":humanNodeId"]
    ) {
      throw transactionConditionalError();
    }

    const existingCheckpoint = this.items.get(this.key(checkpointPut.Item as Record<string, unknown>));
    const checkpointValues = checkpointPut.ExpressionAttributeValues ?? {};
    const existingCheckpointRecord = existingCheckpoint?.record as RunCheckpoint | undefined;
    if (
      !existingCheckpoint ||
      existingCheckpoint.entity !== checkpointValues[":checkpointEntity"] ||
      existingCheckpoint.automationId !== checkpointValues[":automationId"] ||
      existingCheckpoint.workflowVersion !== checkpointValues[":workflowVersion"] ||
      existingCheckpointRecord?.currentNodeId !== checkpointValues[":humanNodeId"] ||
      existingCheckpointRecord.updatedAt !== checkpointValues[":expectedUpdatedAt"]
    ) {
      throw transactionConditionalError();
    }

    this.items.set(
      this.key(runPut.Item as Record<string, unknown>),
      structuredClone(runPut.Item as Record<string, unknown>),
    );
    this.items.set(
      this.key(checkpointPut.Item as Record<string, unknown>),
      structuredClone(checkpointPut.Item as Record<string, unknown>),
    );
    return {};
  }
}

function seed(client: FakeDynamo, req = request()): void {
  let capturedPk = "";
  let capturedRunSk = "";
  let capturedCheckpointSk = "";
  let capturedLeaseSk = "";
  const probe: DynamoDocumentClientLike = {
    async send(command) {
      if (!(command instanceof TransactWriteCommand)) throw new Error("expected transaction");
      capturedLeaseSk = String(command.input.TransactItems?.[0]?.ConditionCheck?.Key?.sk);
      capturedRunSk = String(command.input.TransactItems?.[1]?.Put?.Item?.sk);
      capturedCheckpointSk = String(command.input.TransactItems?.[2]?.Put?.Item?.sk);
      capturedPk = String(command.input.TransactItems?.[1]?.Put?.Item?.pk);
      throw new Error("probe");
    },
  };
  void new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(probe, config)
    .commit(req)
    .catch(() => undefined);

  client.seed(capturedPk, capturedRunSk, {
    entity: "RUN",
    automationId: req.expectedRun.automationId,
    workflowVersion: req.expectedRun.workflowVersion,
    occurrenceKey: req.expectedRun.occurrenceKey,
    record: req.expectedRun,
  });
  client.seed(capturedPk, capturedCheckpointSk, {
    entity: "CHECKPOINT",
    automationId: req.expectedCheckpoint.automationId,
    workflowVersion: req.expectedCheckpoint.workflowVersion,
    record: req.expectedCheckpoint,
  });
  client.seed(capturedPk, capturedLeaseSk, {
    entity: "HUMAN_RESUME_EXECUTION_LEASE",
    resolutionId: req.lease.resolutionId,
    ownerToken: req.lease.ownerToken,
    state: "ACTIVE",
    expiresAtEpochMs: new Date(req.lease.expiresAt).getTime(),
    lease: req.lease,
  });
}

describe("AwsDynamoHumanResumeAlreadyAppliedTransitionStore", () => {
  it("advances run and checkpoint atomically while the exact lease is live", async () => {
    const client = new FakeDynamo();
    const req = request();
    seed(client, req);
    const store = new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(client, config);

    const result = await store.commit(req);
    expect(result.status).toBe("APPLIED");
    if (result.status !== "APPLIED") throw new Error("expected APPLIED");
    expect(result.run).toMatchObject({ status: "RUNNING", currentNodeId: "end" });
    expect(result.checkpoint).toEqual(req.nextCheckpoint);
  });

  it("classifies an exact duplicate as REPLAY using strongly consistent reads", async () => {
    const client = new FakeDynamo();
    const req = request();
    seed(client, req);
    const store = new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(client, config);

    expect((await store.commit(req)).status).toBe("APPLIED");
    expect((await store.commit(req)).status).toBe("REPLAY");
    expect(client.lastGets).toHaveLength(2);
    expect(client.lastGets.every((get) => get.input.ConsistentRead === true)).toBe(true);
  });

  it("returns CONFLICT for stale paused state or lost lease ownership", async () => {
    const client = new FakeDynamo();
    const req = request();
    seed(client, req);
    const store = new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(client, config);
    await store.commit(req);

    const stale = request();
    stale.nextCheckpoint = { ...stale.nextCheckpoint, updatedAt: "2026-08-19T00:04:00.000Z" };
    expect((await store.commit(stale)).status).toBe("CONFLICT");

    const otherClient = new FakeDynamo();
    seed(otherClient, req);
    for (const item of otherClient.items.values()) {
      if (item.entity === "HUMAN_RESUME_EXECUTION_LEASE") item.ownerToken = "owner-2";
    }
    const otherStore = new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(otherClient, config);
    expect((await otherStore.commit(req)).status).toBe("CONFLICT");
  });

  it("isolates tenant partitions", async () => {
    const client = new FakeDynamo();
    const req = request();
    seed(client, req);
    const store = new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(client, config);

    const foreign = request();
    foreign.scope = { tenantId: "tenant-2", userId: "user-1" };
    await expect(store.commit(foreign)).rejects.toThrow(/ownership/);
  });

  it("propagates transport and non-conditional transaction cancellation uncertainty", async () => {
    const req = request();
    const transport = new FakeDynamo();
    seed(transport, req);
    transport.failWith = Object.assign(new Error("network unavailable"), { name: "TimeoutError" });
    await expect(
      new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(transport, config).commit(req),
    ).rejects.toThrow(/network unavailable/);

    const throttled = new FakeDynamo();
    seed(throttled, req);
    throttled.failWith = Object.assign(new Error("transaction throttled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ThrottlingError" }],
    });
    await expect(
      new AwsDynamoHumanResumeAlreadyAppliedTransitionStore(throttled, config).commit(req),
    ).rejects.toThrow(/transaction throttled/);
  });
});
