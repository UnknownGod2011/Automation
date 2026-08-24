import { describe, expect, it, vi } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import {
  HumanResumeControlPlaneHttpHandler,
  HumanResumeControlPlaneService,
  type HumanResumeExecutionPort,
} from "./human-intervention.js";
import type { CheckpointRepository, OwnershipScope, RunRepository } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const run: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 2,
  occurrenceKey: "test:run-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-21T08:00:00.000Z",
  startedAt: "2026-08-21T08:00:01.000Z",
  currentNodeId: "human-approve",
};
const checkpoint: RunCheckpoint = {
  runId: run.runId,
  automationId: run.automationId,
  workflowVersion: run.workflowVersion,
  currentNodeId: "human-approve",
  completedNodeIds: ["start"],
  variables: {},
  evidenceRefs: [],
  attempt: 0,
  fingerprintRepeatCount: 0,
  updatedAt: "2026-08-21T08:00:02.000Z",
};

function repositories(overrides: { run?: RunRecord | null; checkpoint?: RunCheckpoint | null } = {}) {
  const selectedRun = overrides.run === undefined ? run : overrides.run;
  const selectedCheckpoint = overrides.checkpoint === undefined ? checkpoint : overrides.checkpoint;
  const runs: RunRepository = {
    createIfAbsent: vi.fn(),
    get: vi.fn(async () => selectedRun ? structuredClone(selectedRun) : null),
    update: vi.fn(),
    listForAutomation: vi.fn(async () => []),
  };
  const checkpoints: CheckpointRepository = {
    get: vi.fn(async () => selectedCheckpoint ? structuredClone(selectedCheckpoint) : null),
    put: vi.fn(),
  };
  return { runs, checkpoints };
}

const base = {
  handle: vi.fn(async () => ({ status: 404, body: { error: { code: "NOT_FOUND" } } })),
};

describe("human resume control-plane boundary", () => {
  it("derives the paused node from durable state and forwards only authenticated ownership plus a server-owned resolution identity", async () => {
    const { runs, checkpoints } = repositories();
    const execution: HumanResumeExecutionPort = {
      execute: vi.fn(async (request) => ({
        kind: "RESUMED" as const,
        runId: request.runId,
        status: "SUCCEEDED" as const,
      })),
    };
    const service = new HumanResumeControlPlaneService(runs, checkpoints, execution);

    await expect(service.resume(scope, "auto-1", "run-1")).resolves.toEqual({
      kind: "RESUMED",
      runId: "run-1",
      status: "SUCCEEDED",
    });

    expect(execution.execute).toHaveBeenCalledWith({
      scope,
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "human-approve",
      resolutionId: "authenticated-user-confirm-v1",
    });
  });

  it("does not invoke execution when the run already left the human wait state", async () => {
    const { currentNodeId: _currentNodeId, ...withoutNode } = run;
    const { runs, checkpoints } = repositories({ run: { ...withoutNode, status: "SUCCEEDED" } });
    const execution: HumanResumeExecutionPort = { execute: vi.fn() };
    const service = new HumanResumeControlPlaneService(runs, checkpoints, execution);

    await expect(service.resume(scope, "auto-1", "run-1")).resolves.toEqual({
      kind: "NOT_WAITING",
      runId: "run-1",
      status: "SUCCEEDED",
    });
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-automation access and mismatched durable run/checkpoint nodes before execution", async () => {
    const { runs, checkpoints } = repositories();
    const execution: HumanResumeExecutionPort = { execute: vi.fn() };
    const service = new HumanResumeControlPlaneService(runs, checkpoints, execution);

    await expect(service.resume(scope, "other-auto", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const mismatched = repositories({
      checkpoint: { ...checkpoint, currentNodeId: "another-node" },
    });
    const mismatchedService = new HumanResumeControlPlaneService(
      mismatched.runs,
      mismatched.checkpoints,
      execution,
    );
    await expect(mismatchedService.resume(scope, "auto-1", "run-1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it("ignores ownership, resolution, and expected-node spoofing fields in the HTTP body", async () => {
    const { runs, checkpoints } = repositories();
    const execution: HumanResumeExecutionPort = {
      execute: vi.fn(async () => ({
        kind: "BUSY" as const,
        runId: "run-1",
        status: "WAITING_FOR_HUMAN" as const,
      })),
    };
    const handler = new HumanResumeControlPlaneHttpHandler(
      base,
      new HumanResumeControlPlaneService(runs, checkpoints, execution),
    );

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/runs/run-1/resume",
      body: {
        tenantId: "attacker",
        userId: "attacker",
        resolutionId: "attacker-choice",
        expectedNodeId: "attacker-node",
      },
    }, { scope });

    expect(response).toEqual({
      status: 200,
      body: { kind: "BUSY", runId: "run-1", status: "WAITING_FOR_HUMAN" },
    });
    expect(execution.execute).toHaveBeenCalledWith({
      scope,
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "human-approve",
      resolutionId: "authenticated-user-confirm-v1",
    });
  });
});
