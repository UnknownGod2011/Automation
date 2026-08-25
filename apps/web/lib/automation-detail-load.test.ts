import { describe, expect, it, vi } from "vitest";
import type { AutomationSummaryView } from "@automation/core";
import { loadAutomationDetail, type AutomationDetailReadClient } from "./automation-detail-load";
import { WebControlPlaneError } from "./control-plane-client";

const automation: AutomationSummaryView = {
  automationId: "auto-1",
  name: "History-resilient automation",
  websiteUrl: "https://example.test/app",
  objective: "Keep authoring available during a history outage",
  status: "READY_TO_TEST",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
  needsAttention: false,
};

function client(overrides: Partial<AutomationDetailReadClient> = {}): AutomationDetailReadClient {
  return {
    automation: vi.fn(async () => automation),
    runs: vi.fn(async () => []),
    captureRecording: vi.fn(async () => ({ kind: "NONE" as const })),
    workflow: vi.fn(async () => null),
    ...overrides,
  };
}

describe("automation detail reads", () => {
  it("keeps the automation page usable when only run history is temporarily unavailable", async () => {
    const runs = vi.fn(async () => {
      throw new WebControlPlaneError("CONFLICT");
    });
    const captureRecording = vi.fn(async () => ({ kind: "NONE" as const }));
    const workflow = vi.fn(async () => null);

    const result = await loadAutomationDetail(client({ runs, captureRecording, workflow }), "auto-1");

    expect(result).toEqual({
      automation,
      runs: [],
      captureRecording: { kind: "NONE" },
      workflowInspection: null,
      runHistoryUnavailable: true,
    });
    expect(runs).toHaveBeenCalledWith("auto-1");
    expect(captureRecording).toHaveBeenCalledWith("auto-1");
    expect(workflow).toHaveBeenCalledWith("auto-1");
  });

  it("preserves normal run-history reads", async () => {
    const result = await loadAutomationDetail(client(), "auto-1");
    expect(result.runHistoryUnavailable).toBe(false);
    expect(result.runs).toEqual([]);
  });

  it("does not hide non-history control-plane failures", async () => {
    await expect(loadAutomationDetail(client({
      runs: vi.fn(async () => { throw new WebControlPlaneError("REQUEST_FAILED"); }),
    }), "auto-1")).rejects.toMatchObject({ code: "REQUEST_FAILED" });

    await expect(loadAutomationDetail(client({
      captureRecording: vi.fn(async () => { throw new WebControlPlaneError("CONFLICT"); }),
    }), "auto-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
