import { describe, expect, it } from "vitest";
import type {
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import type { HumanResumeEffectRecord } from "./human-resume-effect.js";
import { planAlreadyAppliedHumanResumeRecovery } from "./human-resume-reconstruction.js";

const retryPolicy = {
  maxAttempts: 1,
  initialBackoffMs: 0,
  maxBackoffMs: 0,
  jitter: false,
  retryableFailureCodes: [] as const,
};

function sideEffectNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "submit",
    kind: "CLICK",
    objective: "Submit once",
    deterministicStrategies: [{ kind: "TEXT", value: "Submit" }],
    inputBindings: {},
    outputBindings: { confirmationId: "confirmation" },
    allowedSideEffects: ["submit-form"],
    verification: {
      description: "success marker",
      mode: "TEXT",
      expected: "Completed",
      timeoutMs: 1_000,
    },
    retryPolicy,
    timeoutMs: 5_000,
    next: ["end"],
    escalation: "HUMAN",
    ...overrides,
  };
}

function graph(successor = sideEffectNode()): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "workflow-1",
    automationId: "automation-1",
    version: 7,
    entryNodeId: "human",
    objective: "test",
    nodes: {
      human: {
        id: "human",
        kind: "HUMAN",
        objective: "repair",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy,
        timeoutMs: 5_000,
        next: [successor.id],
        escalation: "HUMAN",
      },
      [successor.id]: successor,
      end: {
        id: "end",
        kind: "END",
        objective: "done",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy,
        timeoutMs: 5_000,
        next: [],
        escalation: "FAIL",
      },
    },
    createdAt: "2026-08-19T00:00:00.000Z",
  };
}

function run(): RunRecord {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    runId: "run-1",
    automationId: "automation-1",
    workflowVersion: 7,
    occurrenceKey: "occurrence-1",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-19T00:00:00.000Z",
    currentNodeId: "human",
  };
}

function checkpoint(): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "automation-1",
    workflowVersion: 7,
    currentNodeId: "human",
    completedNodeIds: ["before"],
    attempt: 3,
    stateFingerprint: "old-fingerprint",
    fingerprintRepeatCount: 2,
    variables: { existing: "kept" },
    evidenceRefs: ["artifact://before"],
    lastFailure: {
      code: "HUMAN_DECISION_REQUIRED",
      message: "repair",
      retryable: false,
      nodeId: "human",
      evidenceRefs: [],
    },
    updatedAt: "2026-08-19T00:00:00.000Z",
  };
}

function effect(overrides: Partial<HumanResumeEffectRecord> = {}): HumanResumeEffectRecord {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    runId: "run-1",
    humanNodeId: "human",
    successorNodeId: "submit",
    resolutionId: "resolution-1",
    effectId: "effect-1",
    state: "DECIDED",
    preparedAt: "2026-08-19T00:01:00.000Z",
    decision: "ALREADY_APPLIED",
    decidedAt: "2026-08-19T00:02:00.000Z",
    ...overrides,
  };
}

describe("planAlreadyAppliedHumanResumeRecovery", () => {
  it("reconstructs the successful successor checkpoint without mutating paused state", () => {
    const paused = checkpoint();
    const result = planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: paused,
      graph: graph(),
      effect: effect(),
      reconstruction: {
        outputs: { confirmationId: "abc-123", ignored: "not-bound" },
        evidenceRefs: ["artifact://reconciled"],
        stateFingerprint: "post-effect",
      },
      now: "2026-08-19T00:03:00Z",
    });

    expect(result.nextNodeId).toBe("end");
    expect(result.checkpoint).toEqual({
      runId: "run-1",
      automationId: "automation-1",
      workflowVersion: 7,
      currentNodeId: "end",
      completedNodeIds: ["before", "human", "submit"],
      attempt: 0,
      fingerprintRepeatCount: 0,
      variables: { existing: "kept", confirmation: "abc-123" },
      evidenceRefs: ["artifact://before", "artifact://reconciled"],
      updatedAt: "2026-08-19T00:03:00.000Z",
    });
    expect(paused.currentNodeId).toBe("human");
    expect(paused.completedNodeIds).toEqual(["before"]);
    expect(paused.lastFailure?.code).toBe("HUMAN_DECISION_REQUIRED");
  });

  it("uses reconstructed nextNodeId only when it matches a declared branch", () => {
    const successor = sideEffectNode({ next: ["end", "alternate"] });
    const workflow = graph(successor);
    workflow.nodes = {
      ...workflow.nodes,
      alternate: {
        ...workflow.nodes.end!,
        id: "alternate",
      },
    };

    const result = planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: checkpoint(),
      graph: workflow,
      effect: effect(),
      reconstruction: {
        outputs: { nextNodeId: "alternate" },
        evidenceRefs: [],
      },
      now: "2026-08-19T00:03:00.000Z",
    });
    expect(result.nextNodeId).toBe("alternate");

    expect(() => planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: checkpoint(),
      graph: workflow,
      effect: effect(),
      reconstruction: {
        outputs: { nextNodeId: "forged" },
        evidenceRefs: [],
      },
      now: "2026-08-19T00:03:00.000Z",
    })).toThrow("must reconstruct nextNodeId matching one of its declared successors");
  });

  it("rejects non-authoritative or cross-tenant reconciliation records", () => {
    const prepared: HumanResumeEffectRecord = {
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      humanNodeId: "human",
      successorNodeId: "submit",
      resolutionId: "resolution-1",
      effectId: "effect-1",
      state: "PREPARED",
      preparedAt: "2026-08-19T00:01:00.000Z",
    };
    for (const invalidEffect of [
      effect({ decision: "AMBIGUOUS" }),
      prepared,
      effect({ tenantId: "tenant-2" }),
      effect({ userId: "user-2" }),
      effect({ runId: "run-2" }),
    ]) {
      expect(() => planAlreadyAppliedHumanResumeRecovery({
        run: run(),
        checkpoint: checkpoint(),
        graph: graph(),
        effect: invalidEffect,
        reconstruction: { outputs: {}, evidenceRefs: [] },
        now: "2026-08-19T00:03:00.000Z",
      })).toThrow();
    }
  });

  it("rejects control-flow drift and non-verifiable successor reconstruction", () => {
    expect(() => planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: checkpoint(),
      graph: graph(),
      effect: effect({ successorNodeId: "end" }),
      reconstruction: { outputs: {}, evidenceRefs: [] },
      now: "2026-08-19T00:03:00.000Z",
    })).toThrow("does not match the HUMAN control-flow boundary");

    const successor = sideEffectNode({ allowedSideEffects: [] });
    delete successor.verification;
    expect(() => planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: checkpoint(),
      graph: graph(successor),
      effect: effect(),
      reconstruction: { outputs: {}, evidenceRefs: [] },
      now: "2026-08-19T00:03:00.000Z",
    })).toThrow("requires a side-effecting successor with verification");
  });

  it("rejects invalid run/checkpoint/workflow identity and invalid timestamps", () => {
    expect(() => planAlreadyAppliedHumanResumeRecovery({
      run: { ...run(), workflowVersion: 8 },
      checkpoint: checkpoint(),
      graph: graph(),
      effect: effect(),
      reconstruction: { outputs: {}, evidenceRefs: [] },
      now: "2026-08-19T00:03:00.000Z",
    })).toThrow("identity does not match durable run/checkpoint/workflow");

    expect(() => planAlreadyAppliedHumanResumeRecovery({
      run: run(),
      checkpoint: checkpoint(),
      graph: graph(),
      effect: effect(),
      reconstruction: { outputs: {}, evidenceRefs: [] },
      now: "not-a-date",
    })).toThrow("now must be an ISO-8601 timestamp");
  });
});
