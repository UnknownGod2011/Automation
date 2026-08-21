export const CAPTURE_READINESS_POLL_INTERVAL_MS = 2_000;
export const CAPTURE_READINESS_POLL_MAX_ATTEMPTS = 60;

export interface CaptureReadinessPollingState {
  finishRequested: boolean;
  hasLatestCapture: boolean;
}

export function shouldPollCaptureReadiness(state: CaptureReadinessPollingState): boolean {
  return state.finishRequested && !state.hasLatestCapture;
}

export function captureReadinessPollingWindowMs(): number {
  return CAPTURE_READINESS_POLL_INTERVAL_MS * CAPTURE_READINESS_POLL_MAX_ATTEMPTS;
}
