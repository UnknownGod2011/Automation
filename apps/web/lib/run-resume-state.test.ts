import { describe, expect, it } from "vitest";
import type { RunDetailView } from "@automation/core";
import { serverAllowsHumanResume } from "./run-resume-state.js";

function detail(overrides: Partial<RunDetailView> = {}): RunDetailView {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 1,
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-22T02:00:00.000Z",
    checkpoint: {
      completedStepCount: 1,
      attempt: 1,
      fingerprintRepeatCount: 0,
      evidenceCount: 0,
      updatedAt: "2026-08-22T02:00:02.000Z",
    },
    needsHumanAttention: true,
    humanResumeEligible: true,
    targetAuthRepairEligible: false,
    ...overrides,
  };
}

describe("serverAllowsHumanResume", () => {
  it("allows only an authenticated WAITING_FOR_HUMAN detail that advertises explicit HUMAN eligibility", () => {
    expect(serverAllowsHumanResume(detail())).toBe(true);
  });

  it("fails closed when semantic eligibility is false", () => {
    expect(serverAllowsHumanResume(detail({ humanResumeEligible: false }))).toBe(false);
  });

  it("fails closed after the run leaves the durable human wait state", () => {
    expect(serverAllowsHumanResume(detail({ status: "RUNNING" }))).toBe(false);
  });
});
