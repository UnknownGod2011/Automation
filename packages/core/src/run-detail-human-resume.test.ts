import { describe, expect, it } from "vitest";
import type { WorkflowGraph, WorkflowNodeKind } from "@automation/contracts";
import { InMemoryCheckpointRepository, InMemoryRunRepository } from "./memory.js";
import { RunDetailService } from "./run-detail.js";
import type { OwnershipScope, WorkflowVersionRepository } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function graph(kind: WorkflowNodeKind, successors: readonly string[] = ["after"]): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "workflow-1",
    automationId: "auto-1",
    version: 1,
    entryNodeId: "human",
    objective: "Continue after an explicit approval",
    nodes: {
      human: {
        id: "human",
        kind,
        objective: "Wait for user approval",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 1,
          maxBackoffMs: 1,
          jitter: false,
          retryableFailureCodes: [],
        },
        timeoutMs: 1_000,
        next: [...successors],
        escalation: "FAIL",
      },
      after: {
        id: "after",
        kind: "END",
        objective: "Done",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 1,
          maxBackoffMs: 1,
          jitter: false,
          retryableFailureCodes: [],
        },
        timeoutMs: 1_000,
        next: [],
        escalation: "FAIL",
      },
    },
    createdAt: "2026-08-21T08:00:00.000Z",
  };
}

async function repositories() {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  await runs.createIfAbsent({
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 1,
    occurrenceKey: "test:run-1",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-21T08:00:00.000Z",
    currentNodeId: "human",
  });
  await checkpoints.put(scope, {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 1,
    currentNodeId: "human",
    completedNodeIds: [],
    variables: {},
    evidenceRefs: [],
    attempt: 0,
    fingerprintRepeatCount: 0,
    updatedAt: "2026-08-21T08:00:01.000Z",
  });
  return { runs, checkpoints };
}

async function service(workflow: WorkflowGraph) {
  const { runs, checkpoints } = await repositories();
  const workflows: WorkflowVersionRepository = {
    async get() { return structuredClone(workflow); },
    async putImmutable() {},
    async list() { return [structuredClone(workflow)]; },
  };
  return new RunDetailService(runs, checkpoints, workflows);
}

describe("run detail human-resume eligibility", () => {
  it("advertises continuation only for an explicit HUMAN node with one declared successor", async () => {
    const eligible = await service(graph("HUMAN"));
    const ordinaryFailure = await service(graph("CLICK"));
    const ambiguous = await service(graph("HUMAN", ["after", "other"]));

    await expect(eligible.get(scope, "auto-1", "run-1")).resolves.toMatchObject({ humanResumeEligible: true });
    await expect(ordinaryFailure.get(scope, "auto-1", "run-1")).resolves.toMatchObject({ humanResumeEligible: false });
    await expect(ambiguous.get(scope, "auto-1", "run-1")).resolves.toMatchObject({ humanResumeEligible: false });
  });

  it("keeps diagnostics available if workflow storage is temporarily unavailable", async () => {
    const { runs, checkpoints } = await repositories();
    const workflows: WorkflowVersionRepository = {
      async get() { throw new Error("storage unavailable"); },
      async putImmutable() {},
      async list() { return []; },
    };
    const detail = await new RunDetailService(runs, checkpoints, workflows).get(
      scope,
      "auto-1",
      "run-1",
    );

    expect(detail).toMatchObject({
      status: "WAITING_FOR_HUMAN",
      needsHumanAttention: true,
      humanResumeEligible: false,
    });
  });
});
