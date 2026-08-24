import { describe, expect, it } from "vitest";
import type { AutomationSummaryView, RunSummaryView } from "@automation/core";
import {
  automationPhase,
  formatSchedule,
  latestFreshTestFeedback,
  nextRunLabel,
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

function published(schedule: NonNullable<AutomationSummaryView["schedule"]>, overrides: Partial<AutomationSummaryView> = {}): AutomationSummaryView {
  return {
    ...automation,
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    schedule,
    ...overrides,
  };
}

describe("web view model", () => {
  it("renders every durable automation lifecycle state truthfully", () => {
    const cases: ReadonlyArray<[AutomationSummaryView["status"], string]> = [
      ["DRAFT", "Draft"],
      ["CAPTURING", "Capturing"],
      ["COMPILING", "Compiling"],
      ["READY_TO_TEST", "Ready to test"],
      ["TESTING", "Testing"],
      ["READY_TO_PUBLISH", "Ready to publish"],
      ["ACTIVE", "Published"],
      ["RUNNING", "Running"],
      ["PAUSED", "Paused"],
      ["NEEDS_AUTH", "Needs sign-in"],
      ["NEEDS_API_KEY", "Needs API key"],
      ["NEEDS_ATTENTION", "Needs attention"],
      ["DISABLED", "Disabled"],
    ];

    for (const [status, label] of cases) {
      expect(
        automationPhase({
          ...automation,
          status,
          ...(status === "ACTIVE" || status === "RUNNING" || status === "PAUSED" || status === "DISABLED"
            ? { publishedWorkflowVersion: 3 }
            : {}),
        }),
      ).toBe(label);
    }

    expect(automationPhase({ ...automation, status: "ACTIVE", publishedWorkflowVersion: 3, needsAttention: true })).toBe(
      "Needs attention",
    );
    expect(automationPhase({ ...automation, status: "PAUSED", publishedWorkflowVersion: 3 })).not.toBe("Published");
    expect(automationPhase({ ...automation, status: "DISABLED", publishedWorkflowVersion: 3 })).not.toBe("Published");
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

  it("shows the next daily and weekly wall-clock occurrence in the configured timezone", () => {
    const daily = published({ kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" });
    expect(nextRunLabel(daily, new Date("2026-08-22T03:00:00.000Z"))).toBe(
      "Next run: 2026-08-22 09:00 · Asia/Kolkata",
    );
    expect(nextRunLabel(daily, new Date("2026-08-22T04:00:01.000Z"))).toBe(
      "Next run: 2026-08-23 09:00 · Asia/Kolkata",
    );

    const weekly = published({ kind: "WEEKLY", expression: "cron(30 8 ? * SUN *)", timezone: "UTC" });
    expect(nextRunLabel(weekly, new Date("2026-08-22T12:00:00.000Z"))).toBe(
      "Next run: 2026-08-23 08:30 · UTC",
    );
  });

  it("anchors hourly next-run preview only to a durable scheduled occurrence", () => {
    const hourly = published(
      { kind: "HOURLY", expression: "rate(1 hour)", timezone: "UTC" },
      {
        lastRun: run({
          runId: "scheduled-run",
          runKind: "SCHEDULED",
          status: "SUCCEEDED",
          scheduledAt: "2026-08-22T10:15:00.000Z",
        }),
      },
    );
    expect(nextRunLabel(hourly, new Date("2026-08-22T12:20:00.000Z"))).toBe(
      "Next run: 2026-08-22 13:15 · UTC",
    );

    expect(
      nextRunLabel(
        published({ kind: "HOURLY", expression: "rate(1 hour)", timezone: "UTC" }),
        new Date("2026-08-22T12:20:00.000Z"),
      ),
    ).toBe("Next run: hourly from scheduler activation · UTC");

    const freshTestOnly = published(
      { kind: "HOURLY", expression: "rate(1 hour)", timezone: "UTC" },
      { lastRun: run({ runKind: "FRESH_TEST", scheduledAt: "2026-08-22T10:15:00.000Z" }) },
    );
    expect(nextRunLabel(freshTestOnly, new Date("2026-08-22T12:20:00.000Z"))).toBe(
      "Next run: hourly from scheduler activation · UTC",
    );
  });

  it("does not manufacture next-run timestamps when the schedule is paused, disabled, custom, or invalid", () => {
    const daily = { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" } as const;
    expect(nextRunLabel({ ...published(daily), status: "PAUSED" })).toBe("Next run: paused");
    expect(nextRunLabel({ ...published(daily), status: "DISABLED" })).toBe("Next run: disabled");
    expect(
      nextRunLabel(published({ kind: "CRON", expression: "cron(0/15 * * * ? *)", timezone: "UTC" })),
    ).toBe("Next run: custom cron · UTC");
    expect(
      nextRunLabel(published({ kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Invalid/Zone" })),
    ).toBe("Next run: schedule preview unavailable · Invalid/Zone");
    expect(nextRunLabel(automation)).toBe("Next run: not scheduled");
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
