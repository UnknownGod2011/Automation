import { describe, expect, it } from "vitest";
import {
  FRESH_TEST_POLL_INTERVAL_MS,
  FRESH_TEST_POLL_MAX_ATTEMPTS,
  freshTestPollingWindowMs,
  shouldPollFreshTest,
} from "./fresh-test-readiness";

describe("fresh test readiness polling", () => {
  it("polls while the latest fresh test is running", () => {
    expect(shouldPollFreshTest({ submissionAccepted: false, feedbackKind: "RUNNING" })).toBe(true);
    expect(shouldPollFreshTest({ submissionAccepted: false, feedbackKind: "PASSED" })).toBe(false);
    expect(shouldPollFreshTest({ submissionAccepted: false, feedbackKind: "NEEDS_ATTENTION" })).toBe(false);
    expect(shouldPollFreshTest({ submissionAccepted: false, feedbackKind: "NEEDS_CORRECTION" })).toBe(false);
  });

  it("covers the acknowledgement-to-durable-run gap without polling unrelated empty pages", () => {
    expect(shouldPollFreshTest({ submissionAccepted: true, feedbackKind: "NONE" })).toBe(true);
    expect(shouldPollFreshTest({ submissionAccepted: false, feedbackKind: "NONE" })).toBe(false);
  });

  it("uses a bounded low-frequency polling window suitable for long cloud tests", () => {
    expect(FRESH_TEST_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2_000);
    expect(FRESH_TEST_POLL_INTERVAL_MS).toBeLessThanOrEqual(10_000);
    expect(FRESH_TEST_POLL_MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(freshTestPollingWindowMs()).toBeGreaterThan(30_000);
    expect(freshTestPollingWindowMs()).toBeLessThanOrEqual(300_000);
  });
});
