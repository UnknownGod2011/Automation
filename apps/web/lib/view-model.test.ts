import { describe, expect, it } from "vitest";
import type { AutomationSummaryView, RunSummaryView } from "@automation/core";
import {
  automationPhase,
  formatSchedule,
  latestFreshTestFeedback,
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

  it("formats schedules without guessing a next occurrence", () => {
    expect(formatSchedule(automation)).toBe("Not published");
    expect(
      formatSchedule({
        ...automation,
        schedule: { kind: "DAILY", expression: "09:00", timezone: "Asia/Kolkata" },
      }),
    ).toBe("daily · 09:00 · Asia/Kolkata");
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
