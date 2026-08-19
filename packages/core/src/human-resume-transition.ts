import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import type { HumanResumeEffectRecord } from "./human-resume-effect.js";
import type { HumanResumeExecutionLease } from "./human-resume-lease.js";
import type { OwnershipScope } from "./index.js";

export interface HumanResumeAlreadyAppliedTransitionRequest {
  scope: OwnershipScope;
  effect: HumanResumeEffectRecord;
  lease: HumanResumeExecutionLease;
  expectedRun: RunRecord;
  expectedCheckpoint: RunCheckpoint;
  nextCheckpoint: RunCheckpoint;
  committedAt: string;
}

export type HumanResumeAlreadyAppliedTransitionResult =
  | { status: "APPLIED"; run: RunRecord; checkpoint: RunCheckpoint }
  | { status: "REPLAY"; run: RunRecord; checkpoint: RunCheckpoint }
  | { status: "CONFLICT" };

/**
 * Atomic persistence boundary for ALREADY_APPLIED recovery. Implementations must
 * conditionally verify the expected paused run/checkpoint plus live lease ownership,
 * then advance run and checkpoint together or not at all. Storage uncertainty must
 * propagate instead of being guessed as replay/conflict.
 */
export interface HumanResumeAlreadyAppliedTransitionStore {
  commit(
    request: HumanResumeAlreadyAppliedTransitionRequest,
  ): Promise<HumanResumeAlreadyAppliedTransitionResult>;
}

function instant(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
  return parsed;
}

function sameScope(scope: OwnershipScope, candidate: { tenantId: string; userId: string }): boolean {
  return scope.tenantId === candidate.tenantId && scope.userId === candidate.userId;
}

function sameCheckpointIdentity(a: RunCheckpoint, b: RunCheckpoint): boolean {
  return (
    a.runId === b.runId &&
    a.automationId === b.automationId &&
    a.workflowVersion === b.workflowVersion
  );
}

export function buildAlreadyAppliedRecoveryRun(
  request: HumanResumeAlreadyAppliedTransitionRequest,
): RunRecord {
  assertAlreadyAppliedRecoveryTransition(request);
  const { failure: _failure, finishedAt: _finishedAt, ...base } = request.expectedRun;
  return {
    ...base,
    status: "RUNNING",
    currentNodeId: request.nextCheckpoint.currentNodeId,
  };
}

export function assertAlreadyAppliedRecoveryTransition(
  request: HumanResumeAlreadyAppliedTransitionRequest,
): void {
  const {
    scope,
    effect,
    lease,
    expectedRun,
    expectedCheckpoint,
    nextCheckpoint,
  } = request;
  const committedAt = instant(request.committedAt, "committedAt");
  const expectedUpdatedAt = instant(expectedCheckpoint.updatedAt, "expectedCheckpoint.updatedAt");
  const nextUpdatedAt = instant(nextCheckpoint.updatedAt, "nextCheckpoint.updatedAt");
  const leaseExpiry = instant(lease.expiresAt, "lease.expiresAt");

  if (!sameScope(scope, expectedRun) || !sameScope(scope, effect) || !sameScope(scope, lease)) {
    throw new Error("already-applied transition ownership does not match requested scope");
  }
  if (expectedRun.status !== "WAITING_FOR_HUMAN") {
    throw new Error("already-applied transition requires a WAITING_FOR_HUMAN run");
  }
  if (
    expectedRun.currentNodeId !== expectedCheckpoint.currentNodeId ||
    expectedRun.runId !== expectedCheckpoint.runId ||
    expectedRun.automationId !== expectedCheckpoint.automationId ||
    expectedRun.workflowVersion !== expectedCheckpoint.workflowVersion
  ) {
    throw new Error("already-applied transition expected run/checkpoint identity mismatch");
  }
  if (!sameCheckpointIdentity(expectedCheckpoint, nextCheckpoint)) {
    throw new Error("already-applied transition cannot change checkpoint identity");
  }
  if (
    effect.state !== "DECIDED" ||
    effect.decision !== "ALREADY_APPLIED" ||
    effect.runId !== expectedRun.runId ||
    effect.humanNodeId !== expectedCheckpoint.currentNodeId ||
    !nextCheckpoint.completedNodeIds.includes(effect.humanNodeId) ||
    !nextCheckpoint.completedNodeIds.includes(effect.successorNodeId)
  ) {
    throw new Error("already-applied transition does not match durable reconciliation authority");
  }
  if (
    lease.state !== "ACTIVE" ||
    lease.runId !== expectedRun.runId ||
    lease.nodeId !== effect.humanNodeId ||
    lease.resolutionId !== effect.resolutionId
  ) {
    throw new Error("already-applied transition requires matching active execution ownership");
  }
  if (leaseExpiry.getTime() <= committedAt.getTime()) {
    throw new Error("already-applied transition execution lease is expired");
  }
  if (nextUpdatedAt.getTime() < expectedUpdatedAt.getTime()) {
    throw new Error("already-applied transition cannot move checkpoint time backwards");
  }
  if (
    nextCheckpoint.attempt !== 0 ||
    nextCheckpoint.fingerprintRepeatCount !== 0 ||
    nextCheckpoint.lastFailure !== undefined ||
    nextCheckpoint.stateFingerprint !== undefined
  ) {
    throw new Error("already-applied transition next checkpoint must clear retry/failure state");
  }
}
