import type { RunSummaryView } from "@automation/core";

export const RUN_STATUS_POLL_INTERVAL_MS = 5_000;
export const RUN_STATUS_POLL_MAX_ATTEMPTS = 60;

const ACTIVE_RUN_STATUSES = new Set<RunSummaryView["status"]>([
  "QUEUED",
  "PREFLIGHT",
  "RUNNING",
  "RETRYING",
]);

const TERMINAL_RUN_STATUSES = new Set<RunSummaryView["status"]>([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "SKIPPED",
]);

export interface RunStatusPollingState {
  status: RunSummaryView["status"];
  notice?: string;
}

export function shouldPollRunStatus(state: RunStatusPollingState): boolean {
  if (TERMINAL_RUN_STATUSES.has(state.status)) return false;
  if (ACTIVE_RUN_STATUSES.has(state.status)) return true;

  return state.status === "WAITING_FOR_HUMAN" &&
    (state.notice === "resume-submitted" || state.notice === "takeover-finished");
}

export function runStatusPollingWindowMs(): number {
  return RUN_STATUS_POLL_INTERVAL_MS * RUN_STATUS_POLL_MAX_ATTEMPTS;
}
