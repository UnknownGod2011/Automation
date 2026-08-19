import { describe, expect, it } from "vitest";
import type { AutomationSummaryView, RunSummaryView } from "@automation/core";
import { automationPhase, formatSchedule, runTone } from "./view-model.js";

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
    const run = { status: "SUCCEEDED" } as RunSummaryView;
    expect(runTone(run.status)).toBe("success");
    expect(runTone("WAITING_FOR_HUMAN")).toBe("warning");
    expect(runTone("FAILED")).toBe("danger");
    expect(runTone("RUNNING")).toBe("neutral");
  });
});
