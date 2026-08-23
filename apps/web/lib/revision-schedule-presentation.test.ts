import type { AutomationSummaryView } from "@automation/core";
import { describe, expect, it } from "vitest";
import { formatSchedule, nextRunLabel } from "./view-model";

function revision(status: AutomationSummaryView["status"]): AutomationSummaryView {
  return {
    automationId: "automation-1",
    name: "Invoice review",
    websiteUrl: "https://example.com",
    objective: "Review pending invoices",
    status,
    publishedWorkflowVersion: 1,
    schedule: {
      kind: "DAILY",
      expression: "cron(0 9 * * ? *)",
      timezone: "Asia/Kolkata",
    },
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-23T06:00:00.000Z",
    needsAttention: false,
  };
}

describe("revision schedule presentation", () => {
  it("does not advertise a next occurrence while a retained published schedule is disabled for revision", () => {
    for (const status of ["CAPTURING", "COMPILING", "READY_TO_TEST", "TESTING", "READY_TO_PUBLISH"] as const) {
      const automation = revision(status);
      expect(nextRunLabel(automation, new Date("2026-08-23T06:00:00.000Z"))).toBe(
        "Next run: disabled during workflow revision",
      );
      expect(formatSchedule(automation)).toContain("disabled during revision");
    }
  });

  it("continues to preview the schedule once the revised workflow is republished", () => {
    const automation = revision("ACTIVE");
    expect(formatSchedule(automation)).not.toContain("disabled during revision");
    expect(nextRunLabel(automation, new Date("2026-08-23T06:00:00.000Z"))).toContain("Next run: 2026-");
  });

  it("does not mistake an initial unpublished authoring flow for a disabled revision", () => {
    const automation = revision("READY_TO_TEST");
    delete automation.publishedWorkflowVersion;
    delete automation.schedule;
    expect(nextRunLabel(automation, new Date("2026-08-23T06:00:00.000Z"))).toBe("Next run: not scheduled");
    expect(formatSchedule(automation)).toBe("Not published");
  });
});
