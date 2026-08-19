import { describe, expect, it } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import type { HumanResumeEffectRecord } from "./human-resume-effect.js";
import type { HumanResumeExecutionLease } from "./human-resume-lease.js";
import {
  assertAlreadyAppliedRecoveryTransition,
  buildAlreadyAppliedRecoveryRun,
  type HumanResumeAlreadyAppliedTransitionRequest,
} from "./human-resume-transition.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };

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
    failure: {
      code: "HUMAN_DECISION_REQUIRED",
      message: "repair",
      retryable: false,
      nodeId: "human",
      evidenceRefs: [],
    },
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
    stateFingerprint: "old-state",
    fingerprintRepeatCount: 1,
    variables: { before: true },
    evidenceRefs: ["artifact://before"],
    lastFailure: {
      code: "HUMAN_DECISION_REQUIRED",
      message: "repair",
      retryable: false,
      nodeId: "human",
      evidenceRefs: [],
    },
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
    variables: { before: true, confirmation: "abc" },
    evidenceRefs: ["artifact://before", "artifact://reconciled"],
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

function request(
  overrides: Partial<HumanResumeAlreadyAppliedTransitionRequest> = {},
): HumanResumeAlreadyAppliedTransitionRequest {
  return {
    scope,
    effect: effect(),
    lease: lease(),
    expectedRun: run(),
    expectedCheckpoint: paused(),
    nextCheckpoint: next(),
    committedAt: "2026-08-19T00:03:01.000Z",
    ...overrides,
  };
}

describe("already-applied recovery transition contract", () => {
  it("builds the RUNNING run state paired with the reconstructed checkpoint", () => {
    const recovery = request();
    const result = buildAlreadyAppliedRecoveryRun(recovery);

    expect(result).toEqual({
      ...scope,
      runId: "run-1",
      automationId: "automation-1",
      workflowVersion: 7,
      occurrenceKey: "occurrence-1",
      status: "RUNNING",
      scheduledAt: "2026-08-19T00:00:00.000Z",
      startedAt: "2026-08-19T00:00:01.000Z",
      currentNodeId: "end",
    });
    expect(recovery.expectedRun.status).toBe("WAITING_FOR_HUMAN");
  });

  it("rejects expired or mismatched lease ownership", () => {
    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ lease: { ...lease(), expiresAt: "2026-08-19T00:03:00.000Z" } }),
      ),
    ).toThrow(/expired/);

    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ lease: { ...lease(), resolutionId: "other-resolution" } }),
      ),
    ).toThrow(/active execution ownership/);
  });

  it("rejects reconciliation identity drift and non-ALREADY_APPLIED decisions", () => {
    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ effect: { ...effect(), successorNodeId: "other" } }),
      ),
    ).toThrow(/reconciliation authority/);

    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ effect: { ...effect(), decision: "AMBIGUOUS" } }),
      ),
    ).toThrow(/reconciliation authority/);
  });

  it("rejects stale checkpoint identity and uncleared retry state", () => {
    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ nextCheckpoint: { ...next(), workflowVersion: 8 } }),
      ),
    ).toThrow(/checkpoint identity/);

    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ nextCheckpoint: { ...next(), attempt: 1 } }),
      ),
    ).toThrow(/clear retry\/failure state/);
  });

  it("rejects ownership drift and backwards checkpoint timestamps", () => {
    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ scope: { tenantId: "tenant-2", userId: "user-1" } }),
      ),
    ).toThrow(/ownership/);

    expect(() =>
      assertAlreadyAppliedRecoveryTransition(
        request({ nextCheckpoint: { ...next(), updatedAt: "2026-08-18T23:59:00.000Z" } }),
      ),
    ).toThrow(/backwards/);
  });
});
