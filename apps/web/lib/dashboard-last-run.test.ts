import type { RunSummaryView } from "@automation/core";
import { describe, expect, it } from "vitest";
import { dashboardLastRunPresentation } from "./dashboard-last-run.js";

function run(overrides: Partial<RunSummaryView>): RunSummaryView {
  return {
    runId: "internal-run-id",
    automationId: "automation-1",
    workflowVersion: 3,
    status: "RUNNING",
    scheduledAt: "2026-08-23T06:00:00.000Z",
    currentNodeId: "internal-node-id",
    ...overrides,
  };
}

describe("dashboard last-run presentation", () => {
  it("distinguishes fresh tests from scheduled production runs", () => {
    expect(dashboardLastRunPresentation(run({ runKind: "FRESH_TEST", status: "SUCCEEDED" }))).toEqual({
      kind: "Fresh test",
      detail: "Verified successfully",
      tone: "success",
    });
    expect(dashboardLastRunPresentation(run({ runKind: "SCHEDULED", status: "RUNNING" }))).toEqual({
      kind: "Scheduled run",
      detail: "Execution in progress",
      tone: "neutral",
    });
  });

  it("surfaces only the classified failure code for attention state", () => {
    const presentation = dashboardLastRunPresentation(
      run({ runKind: "SCHEDULED", status: "WAITING_FOR_HUMAN", failureCode: "TARGET_AUTH_REQUIRED" }),
    );
    expect(presentation).toEqual({
      kind: "Scheduled run",
      detail: "Needs attention · TARGET_AUTH_REQUIRED",
      tone: "warning",
    });
    expect(JSON.stringify(presentation)).not.toContain("internal-run-id");
    expect(JSON.stringify(presentation)).not.toContain("internal-node-id");
  });
});
