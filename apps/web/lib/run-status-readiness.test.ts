import { describe, expect, it } from "vitest";
import {
  RUN_STATUS_POLL_INTERVAL_MS,
  RUN_STATUS_POLL_MAX_ATTEMPTS,
  runStatusPollingWindowMs,
  shouldPollRunStatus,
} from "./run-status-readiness";

describe("shouldPollRunStatus", () => {
  it("polls while durable execution is active", () => {
    for (const status of ["QUEUED", "PREFLIGHT", "RUNNING", "RETRYING"] as const) {
      expect(shouldPollRunStatus({ status })).toBe(true);
    }
  });

  it("polls a paused run only after a trusted resume or repair submission", () => {
    expect(shouldPollRunStatus({ status: "WAITING_FOR_HUMAN", notice: "resume-submitted" })).toBe(true);
    expect(shouldPollRunStatus({ status: "WAITING_FOR_HUMAN", notice: "takeover-finished" })).toBe(true);
    expect(shouldPollRunStatus({ status: "WAITING_FOR_HUMAN" })).toBe(false);
    expect(shouldPollRunStatus({ status: "WAITING_FOR_HUMAN", notice: "resume-failed" })).toBe(false);
    expect(shouldPollRunStatus({ status: "WAITING_FOR_HUMAN", notice: "takeover-failed" })).toBe(false);
  });

  it("stops immediately once the durable run is terminal even if a submission notice remains in the URL", () => {
    for (const status of ["SUCCEEDED", "FAILED", "CANCELED", "SKIPPED"] as const) {
      expect(shouldPollRunStatus({ status, notice: "resume-submitted" })).toBe(false);
      expect(shouldPollRunStatus({ status, notice: "takeover-finished" })).toBe(false);
    }
  });

  it("keeps the polling window bounded", () => {
    expect(RUN_STATUS_POLL_INTERVAL_MS).toBe(5_000);
    expect(RUN_STATUS_POLL_MAX_ATTEMPTS).toBe(60);
    expect(runStatusPollingWindowMs()).toBe(300_000);
  });
});
