import { describe, expect, it } from "vitest";
import {
  CAPTURE_READINESS_POLL_INTERVAL_MS,
  CAPTURE_READINESS_POLL_MAX_ATTEMPTS,
  captureReadinessPollingWindowMs,
  shouldPollCaptureReadiness,
} from "./capture-readiness";

describe("capture readiness polling", () => {
  it("polls only after finish is requested and before a completed capture is visible", () => {
    expect(shouldPollCaptureReadiness({ finishRequested: false, hasLatestCapture: false })).toBe(false);
    expect(shouldPollCaptureReadiness({ finishRequested: true, hasLatestCapture: false })).toBe(true);
    expect(shouldPollCaptureReadiness({ finishRequested: true, hasLatestCapture: true })).toBe(false);
  });

  it("uses a bounded low-frequency polling window", () => {
    expect(CAPTURE_READINESS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
    expect(CAPTURE_READINESS_POLL_INTERVAL_MS).toBeLessThanOrEqual(5_000);
    expect(CAPTURE_READINESS_POLL_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(captureReadinessPollingWindowMs()).toBeLessThanOrEqual(120_000);
  });
});
