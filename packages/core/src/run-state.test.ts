import { describe, expect, it } from "vitest";
import type { RunFailure, RunRecord } from "@automation/contracts";
import { canTransitionRun, isTerminalRunStatus, transitionRun } from "./index.js";

const baseRun = (): RunRecord => ({
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 1,
  occurrenceKey: "auto-1:2026-08-18T12:00:00.000Z",
  status: "QUEUED",
  scheduledAt: "2026-08-18T12:00:00.000Z",
});

const failure: RunFailure = {
  code: "EFFECT_NOT_VERIFIED",
  message: "Expected effect was not observed",
  retryable: false,
  evidenceRefs: ["evidence://1"],
};

describe("run state machine", () => {
  it("allows the normal queued -> preflight -> running -> success lifecycle", () => {
    const preflight = transitionRun(baseRun(), "PREFLIGHT", {
      now: "2026-08-18T12:00:01.000Z",
    });
    const running = transitionRun(preflight, "RUNNING", {
      now: "2026-08-18T12:00:02.000Z",
      currentNodeId: "step-1",
    });
    const succeeded = transitionRun(running, "SUCCEEDED", {
      now: "2026-08-18T12:00:05.000Z",
    });

    expect(preflight.startedAt).toBe("2026-08-18T12:00:01.000Z");
    expect(running.startedAt).toBe(preflight.startedAt);
    expect(succeeded.finishedAt).toBe("2026-08-18T12:00:05.000Z");
    expect(isTerminalRunStatus(succeeded.status)).toBe(true);
  });

  it("supports bounded retry and human-resume paths", () => {
    expect(canTransitionRun("RUNNING", "RETRYING")).toBe(true);
    expect(canTransitionRun("RETRYING", "WAITING_FOR_HUMAN")).toBe(true);
    expect(canTransitionRun("WAITING_FOR_HUMAN", "RUNNING")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(() =>
      transitionRun(baseRun(), "SUCCEEDED", { now: "2026-08-18T12:00:01.000Z" }),
    ).toThrow(/invalid run transition/);
  });

  it("requires structured failure details when entering FAILED", () => {
    const preflight = transitionRun(baseRun(), "PREFLIGHT", {
      now: "2026-08-18T12:00:01.000Z",
    });

    expect(() =>
      transitionRun(preflight, "FAILED", { now: "2026-08-18T12:00:02.000Z" }),
    ).toThrow(/requires failure details/);

    const failed = transitionRun(preflight, "FAILED", {
      now: "2026-08-18T12:00:02.000Z",
      failure,
    });
    expect(failed.failure?.code).toBe("EFFECT_NOT_VERIFIED");
  });
});
