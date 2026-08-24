import { describe, expect, it, vi } from "vitest";
import type { AutomationSummaryView, RunSummaryView } from "./control-plane.js";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

function lifecycle(): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => { throw new Error("unexpected create"); }),
    persistCapture: vi.fn(async () => { throw new Error("unexpected capture persistence"); }),
    compile: vi.fn(async () => { throw new Error("unexpected compile"); }),
    runFreshTest: vi.fn(async () => { throw new Error("unexpected local fresh test"); }),
    publish: vi.fn(async () => { throw new Error("unexpected publish"); }),
    history: vi.fn(async () => []),
  };
}

function service(): AutomationControlPlaneService {
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  return new AutomationControlPlaneService({
    automations: new InMemoryAutomationRepository(),
    runs: new InMemoryRunRepository(),
    lifecycle: lifecycle(),
    captureSessions,
    captureState: new InMemoryCaptureSessionStore(),
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "LOCAL_MOCK",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "LOCAL_MOCK",
      notifications: "LOCAL_MOCK",
    },
  });
}

function publishedSummary(): AutomationSummaryView {
  return {
    automationId: "auto-1",
    name: "Post daily report",
    websiteUrl: "https://example.test/app",
    objective: "Post the daily report",
    status: "ACTIVE",
    publishedWorkflowVersion: 2,
    schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-24T05:00:00.000Z",
    updatedAt: "2026-08-24T05:30:00.000Z",
    needsAttention: false,
  };
}

const run = (
  runId: string,
  workflowVersion: number,
  status: RunSummaryView["status"],
  runKind: NonNullable<RunSummaryView["runKind"]>,
): RunSummaryView => ({
  runId,
  automationId: "auto-1",
  workflowVersion,
  status,
  scheduledAt: "2026-08-24T05:15:00.000Z",
  runKind,
});

describe("authenticated control-plane Publish workflow authority", () => {
  it("derives the publish version from successful Fresh Test history and ignores caller-supplied workflowVersion", async () => {
    const controlPlane = service();
    vi.spyOn(controlPlane, "history").mockResolvedValue([
      run("scheduled-99", 99, "SUCCEEDED", "SCHEDULED"),
      run("test-2", 2, "SUCCEEDED", "FRESH_TEST"),
      run("test-3", 3, "FAILED", "FRESH_TEST"),
    ]);
    const publish = vi.spyOn(controlPlane, "publishAutomation").mockResolvedValue(publishedSummary());
    const handler = new AutomationControlPlaneHttpHandler(controlPlane);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/publish",
        body: {
          workflowVersion: 777,
          tenantId: "tenant-attacker",
          userId: "user-attacker",
          schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
        },
      },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      { tenantId: "tenant-owner", userId: "user-owner" },
      "auto-1",
      {
        workflowVersion: 2,
        schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
      },
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain("777");
    expect(JSON.stringify(publish.mock.calls)).not.toContain("tenant-attacker");
  });

  it("fails closed when durable history has no successful Fresh Test version", async () => {
    const controlPlane = service();
    vi.spyOn(controlPlane, "history").mockResolvedValue([
      run("scheduled-4", 4, "SUCCEEDED", "SCHEDULED"),
      run("test-5", 5, "FAILED", "FRESH_TEST"),
    ]);
    const publish = vi.spyOn(controlPlane, "publishAutomation").mockResolvedValue(publishedSummary());
    const handler = new AutomationControlPlaneHttpHandler(controlPlane);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/publish",
        body: {
          workflowVersion: 5,
          schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
        },
      },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: {
          code: "CONFLICT",
          message: "a successful fresh test is required before publication",
        },
      },
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
