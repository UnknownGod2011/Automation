import type { RunFailure, RunRecord, RunStatus } from "@automation/contracts";

const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  QUEUED: ["PREFLIGHT", "CANCELED", "SKIPPED"],
  PREFLIGHT: ["RUNNING", "WAITING_FOR_HUMAN", "FAILED", "CANCELED", "SKIPPED"],
  RUNNING: ["RETRYING", "WAITING_FOR_HUMAN", "SUCCEEDED", "FAILED", "CANCELED"],
  RETRYING: ["RUNNING", "WAITING_FOR_HUMAN", "FAILED", "CANCELED"],
  WAITING_FOR_HUMAN: ["RUNNING", "FAILED", "CANCELED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELED: [],
  SKIPPED: [],
};

const TERMINAL: readonly RunStatus[] = ["SUCCEEDED", "FAILED", "CANCELED", "SKIPPED"];

export interface RunTransitionOptions {
  now: string;
  currentNodeId?: string;
  failure?: RunFailure;
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL.includes(status);
}

export function transitionRun(
  run: RunRecord,
  nextStatus: RunStatus,
  options: RunTransitionOptions,
): RunRecord {
  if (!canTransitionRun(run.status, nextStatus)) {
    throw new Error(`invalid run transition ${run.status} -> ${nextStatus}`);
  }

  if (nextStatus === "FAILED" && !options.failure) {
    throw new Error("FAILED transition requires failure details");
  }

  if (nextStatus !== "FAILED" && options.failure) {
    throw new Error("failure details are only valid for FAILED transitions");
  }

  const startedAt = run.startedAt ?? (nextStatus === "PREFLIGHT" || nextStatus === "RUNNING" ? options.now : undefined);
  const finishedAt = isTerminalRunStatus(nextStatus) ? options.now : undefined;

  return {
    ...run,
    status: nextStatus,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(options.currentNodeId !== undefined ? { currentNodeId: options.currentNodeId } : {}),
    ...(options.failure ? { failure: options.failure } : {}),
  };
}
