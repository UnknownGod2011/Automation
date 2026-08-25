import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, RunRecord } from "@automation/contracts";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureCompletionReader,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import type { OwnershipScope, RunRepository } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function automation(id = "auto-1"): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: id,
    name: `Automation ${id}`,
    websiteUrl: "https://example.test/app",
    prompt: "Keep metadata usable during history outages",
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "UTC" },
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function unusedLifecycle(): AutomationLifecyclePort {
  const unused = async (): Promise<never> => { throw new Error("unused lifecycle method"); };
  return {
    createDraft: vi.fn(unused),
    persistCapture: vi.fn(unused),
    compile: vi.fn(unused),
    runFreshTest: vi.fn(unused),
    publish: vi.fn(unused),
    history: vi.fn(unused),
  };
}

async function makeService(options: {
  automations?: readonly AutomationRecord[];
  listForAutomation: RunRepository["listForAutomation"];
  captureState?: CaptureCompletionReader;
}) {
  const automations = new InMemoryAutomationRepository();
  for (const record of options.automations ?? [automation()]) await automations.put(record);
  const baseRuns = new InMemoryRunRepository();
  const runs: RunRepository = {
    createIfAbsent: (run) => baseRuns.createIfAbsent(run),
    get: (scope, runId) => baseRuns.get(scope, runId),
    update: (run) => baseRuns.update(run),
    listForAutomation: options.listForAutomation,
  };
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  const captureState: CaptureCompletionReader = options.captureState ?? {
    latestCompletedForAutomation: vi.fn(async () => null),
  };
  return new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: unusedLifecycle(),
    captureSessions,
    captureState,
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "NOT_CONFIGURED",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "LOCAL_MOCK",
      notifications: "NOT_CONFIGURED",
    },
  });
}

describe("automation metadata isolation from run history", () => {
  it("loads owned automation metadata without touching the run repository", async () => {
    const listForAutomation = vi.fn(async (): Promise<readonly RunRecord[]> => {
      throw new Error("run store unavailable");
    });
    const service = await makeService({ listForAutomation });

    await expect(service.getAutomation(owner, "auto-1")).resolves.toEqual(
      expect.objectContaining({ automationId: "auto-1", status: "ACTIVE" }),
    );
    expect(listForAutomation).not.toHaveBeenCalled();
  });

  it("keeps the dashboard available when one automation history read fails", async () => {
    const second = { ...automation("auto-2"), updatedAt: "2026-08-25T00:01:00.000Z" };
    const run: RunRecord = {
      tenantId: owner.tenantId,
      userId: owner.userId,
      runId: "run-2",
      automationId: "auto-2",
      workflowVersion: 1,
      occurrenceKey: "auto-2:2026-08-25T00:02:00.000Z",
      status: "SUCCEEDED",
      scheduledAt: "2026-08-25T00:02:00.000Z",
      finishedAt: "2026-08-25T00:03:00.000Z",
    };
    const listForAutomation = vi.fn(async (_scope: OwnershipScope, automationId: string): Promise<readonly RunRecord[]> => {
      if (automationId === "auto-1") throw new Error("transient history outage");
      return [run];
    });
    const captureState: CaptureCompletionReader = {
      latestCompletedForAutomation: vi.fn(async () => {
        throw new Error("dashboard should not read capture completion state");
      }),
    };
    const service = await makeService({ automations: [automation(), second], listForAutomation, captureState });

    const dashboard = await service.dashboard(owner);
    const unavailable = dashboard.automations.find((item) => item.automationId === "auto-1");
    const healthy = dashboard.automations.find((item) => item.automationId === "auto-2");

    expect(unavailable).toEqual(expect.objectContaining({ automationId: "auto-1", lastRunUnavailable: true }));
    expect(unavailable?.lastRun).toBeUndefined();
    expect(healthy).toEqual(expect.objectContaining({ automationId: "auto-2", lastRun: expect.objectContaining({ runId: "run-2", status: "SUCCEEDED" }) }));
    expect(healthy?.lastRunUnavailable).toBeUndefined();
    expect(captureState.latestCompletedForAutomation).not.toHaveBeenCalled();
  });

  it("keeps metadata-only mutation responses independent of history availability", async () => {
    const listForAutomation = vi.fn(async (): Promise<readonly RunRecord[]> => {
      throw new Error("history unavailable");
    });
    const service = await makeService({ listForAutomation });

    await expect(service.updateNotificationPreferences(owner, "auto-1", {
      notifyOnSuccess: false,
      notifyOnFailure: true,
    })).resolves.toEqual(expect.objectContaining({ automationId: "auto-1", notifyOnFailure: true }));
    expect(listForAutomation).not.toHaveBeenCalled();
  });
});
