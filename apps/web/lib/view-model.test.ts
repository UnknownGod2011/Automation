import { describe, expect, it } from "vitest";
import type { AutomationSummaryView, RunSummaryView } from "@automation/core";
import {
  automationPhase,
  formatSchedule,
  latestFreshTestFeedback,
  runHistoryStatusDetail,
  runKindLabel,
  runTone,
} from "./view-model.js";

const automation: AutomationSummaryView = {
  automationId: "a1",
  name: "Invoice sync",
  websiteUrl: "https://example.test",
  objective: "Sync approved invoices",
  status: "DRAFT",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  needsAttention: false,
};

function run(overrides: Partial<RunSummaryView>): RunSummaryView {
  return {
    runId: "run-1",
    automationId: "a1",
    workflowVersion: 1,
    status: "RUNNING",
    scheduledAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("web view model", () => {
  it("distinguishes draft, published, and attention states", () => {
    expect(automationPhase(automation)).toBe("Draft");
    expect(automationPhase({ ...automation, status: "ACTIVE", publishedWorkflowVersion: 3 })).toBe("Published");
    expect(automationPhase({ ...automation, status: "NEEDS_ATTENTION", needsAttention: true })).toBe("Needs attention");
  });

  it("formats normalized schedules without exposing provider syntax when it is recognized", () => {
    expect(formatSchedule(automation)).toBe("Not published");
    expect(
      formatSchedule({
        ...automation,
        schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
      }),
    ).toBe("daily at 09:00 · Asia/Kolkata");
  });

  it("maps run statuses to stable presentation tones", () => {
    const summary = { status: "SUCCEEDED" } as RunSummaryView;
    expect(runTone(summary.status)).toBe("success");
    expect(runTone("WAITING_FOR_HUMAN")).toBe("warning");
    expect(runTone("FAILED")).toBe("danger");
    expect(runTone("RUNNING")).toBe("neutral");
  });

  it("labels fresh tests separately from scheduled runs", () => {
    expect(runKindLabel(run({ runKind: "FRESH_TEST" }))).toBe("Fresh test");
    expect(runKindLabel(run({ runKind: "SCHEDULED" }))).toBe("Scheduled run");
    expect(runKindLabel(run({}))).toBe("Run");
  });

  it("renders user-facing history status without durable run or node identifiers", () => {
    expect(runHistoryStatusDetail(run({ status: "SUCCEEDED", runId: "secret-run", currentNodeId: "internal-node" }))).toBe(
      "Verified successfully",
    );
    expect(
      runHistoryStatusDetail(
        run({ status: "WAITING_FOR_HUMAN", failureCode: "TARGET_AUTH_REQUIRED", currentNodeId: "login-node" }),
      ),
    ).toBe("Needs attention · TARGET_AUTH_REQUIRED");
    expect(runHistoryStatusDetail(run({ status: "FAILED", failureCode: "EFFECT_NOT_VERIFIED" }))).toBe(
      "Failed · EFFECT_NOT_VERIFIED",
    );
    expect(runHistoryStatusDetail(run({ status: "PREFLIGHT" }))).toBe("Preparing cloud execution");
    expect(runHistoryStatusDetail(run({ status: "RUNNING" }))).toBe("Execution in progress");
  });

  it("turns the latest fresh-test outcome into an actionable correction state", () => {
    const scheduled = run({
      runId: "scheduled-newer",
      runKind: "SCHEDULED",
      status: "FAILED",
      scheduledAt: "2026-08-19T00:05:00.000Z",
    });
    const failedTest = run({
      runId: "test-failed",
      runKind: "FRESH_TEST",
      status: "FAILED",
      scheduledAt: "2026-08-19T00:04:00.000Z",
    });
    const olderPassedTest = run({
      runId: "test-passed",
      runKind: "FRESH_TEST",
      status: "SUCCEEDED",
      scheduledAt: "2026-08-19T00:03:00.000Z",
    });

    expect(latestFreshTestFeedback([olderPassedTest, scheduled, failedTest])).toEqual({
      kind: "NEEDS_CORRECTION",
      run: failedTest,
    });
    expect(latestFreshTestFeedback([run({ runKind: "FRESH_TEST", status: "WAITING_FOR_HUMAN" })]).kind).toBe(
      "NEEDS_ATTENTION",
    );
    expect(latestFreshTestFeedback([run({ runKind: "FRESH_TEST", status: "SUCCEEDED" })]).kind).toBe("PASSED");
    expect(latestFreshTestFeedback([scheduled])).toEqual({ kind: "NONE" });
  });
});
