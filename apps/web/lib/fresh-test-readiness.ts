import type { FreshTestFeedback } from "./view-model";

export const FRESH_TEST_POLL_INTERVAL_MS = 5_000;
export const FRESH_TEST_POLL_MAX_ATTEMPTS = 60;

export interface FreshTestPollingState {
  submissionAccepted: boolean;
  feedbackKind: FreshTestFeedback["kind"];
}

export function shouldPollFreshTest(state: FreshTestPollingState): boolean {
  return state.feedbackKind === "RUNNING" || (state.submissionAccepted && state.feedbackKind === "NONE");
}

export function freshTestPollingWindowMs(): number {
  return FRESH_TEST_POLL_INTERVAL_MS * FRESH_TEST_POLL_MAX_ATTEMPTS;
}
