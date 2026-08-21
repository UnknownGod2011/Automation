import { describe, expect, it } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import { InMemoryCheckpointRepository, InMemoryRunRepository } from "./memory.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import { RunDetailControlPlaneHttpHandler, RunDetailService } from "./run-detail.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function pausedRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    occurrenceKey: "auto-1:2026-08-21T08:00:00.000Z",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-21T08:00:00.000Z",
    startedAt: "2026-08-21T08:00:01.000Z",
    currentNodeId: "submit",
    failure: {
      code: "EFFECT_NOT_VERIFIED",
      message: "private provider/browser detail must not leave the service",
      retryable: false,
      nodeId: "submit",
      evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    },
    ...overrides,
  };
}

function pausedCheckpoint(overrides: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    currentNodeId: "submit",
    completedNodeIds: ["open", "fill"],
    attempt: 2,
    stateFingerprint: "private-page-fingerprint",
    fingerprintRepeatCount: 2,
    variables: { password: "must-never-be-returned", customer: "private-runtime-value" },
    evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    lastFailure: {
      code: "EFFECT_NOT_VERIFIED",
      message: "private checkpoint detail",
      retryable: false,
      nodeId: "submit",
      evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    },
    updatedAt: "2026-08-21T08:00:10.000Z",
    ...overrides,
  };
}

async function setup() {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  await runs.createIfAbsent(pausedRun());
  await checkpoints.put(owner, pausedCheckpoint());
  return { runs, checkpoints, service: new RunDetailService(runs, checkpoints) };
}

describe("RunDetailService", () => {
  it("returns bounded diagnostic state without variables, raw failures, or fingerprints", async () => {
    const { service } = await setup();

    const detail = await service.get(owner, "auto-1", "run-1");

    expect(detail).toMatchObject({
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 3,
      status: "WAITING_FOR_HUMAN",
      currentNodeId: "submit",
      needsHumanAttention: true,
      failure: {
        code: "EFFECT_NOT_VERIFIED",
        retryable: false,
        nodeId: "submit",
      },
      checkpoint: {
        currentNodeId: "submit",
        completedNodeIds: ["open", "fill"],
        attempt: 2,
        fingerprintRepeatCount: 2,
        updatedAt: "2026-08-21T08:00:10.000Z",
      },
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("must-never-be-returned");
    expect(serialized).not.toContain("private-runtime-value");
    expect(serialized).not.toContain("private-page-fingerprint");
    expect(serialized).not.toContain("private provider/browser detail");
    expect(serialized).not.toContain("private checkpoint detail");
  });

  it("does not reveal a run across tenant or automation boundaries", async () => {
    const { service } = await setup();

    await expect(service.get(attacker, "auto-1", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.get(owner, "auto-other", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails closed when checkpoint durable identity disagrees with the run", async () => {
    const { runs, checkpoints } = await setup();
    await checkpoints.put(owner, pausedCheckpoint({ workflowVersion: 4 }));
    const service = new RunDetailService(runs, checkpoints);

    await expect(service.get(owner, "auto-1", "run-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects unbounded or malformed evidence references rather than reflecting corrupted state", async () => {
    const { runs, checkpoints } = await setup();
    await checkpoints.put(owner, pausedCheckpoint({ evidenceRefs: ["x".repeat(513)] }));
    const service = new RunDetailService(runs, checkpoints);

    await expect(service.get(owner, "auto-1", "run-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("RunDetailControlPlaneHttpHandler", () => {
  it("serves the authenticated run-detail route and delegates unrelated traffic", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = {
      async handle() {
        return { status: 418, body: { delegated: true } };
      },
    };
    const handler = new RunDetailControlPlaneHttpHandler(base, service);

    const detail = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs/run-1" },
      { scope: owner },
    );
    const delegated = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1" },
      { scope: owner },
    );

    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ runId: "run-1", needsHumanAttention: true });
    expect(delegated).toEqual({ status: 418, body: { delegated: true } });
  });

  it("returns not found for cross-tenant run detail without leaking whether the run exists", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = { async handle() { return { status: 404, body: {} }; } };
    const handler = new RunDetailControlPlaneHttpHandler(base, service);

    const response = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs/run-1" },
      { scope: attacker },
    );

    expect(response).toEqual({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "run not found" } },
    });
  });
});
