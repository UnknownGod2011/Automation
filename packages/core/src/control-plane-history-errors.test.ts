import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, RunRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  AutomationControlPlaneHttpHandler,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { ControlPlaneError } from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import type { OwnershipScope, RunRepository } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "History test",
    websiteUrl: "https://example.test/app",
    prompt: "Read history safely",
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

async function makeService(listForAutomation: RunRepository["listForAutomation"]) {
  const automations = new InMemoryAutomationRepository();
  await automations.put(automation());
  const baseRuns = new InMemoryRunRepository();
  const runs: RunRepository = {
    createIfAbsent: (run) => baseRuns.createIfAbsent(run),
    get: (scope, runId) => baseRuns.get(scope, runId),
    update: (run) => baseRuns.update(run),
    listForAutomation,
  };
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: unusedLifecycle(),
    captureSessions,
    captureState: new InMemoryCaptureSessionStore(),
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "NOT_CONFIGURED",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "LOCAL_MOCK",
      notifications: "NOT_CONFIGURED",
    },
  });
  return service;
}

describe("run-history availability classification", () => {
  it("keeps ownership NOT_FOUND distinct from run-store availability", async () => {
    const listForAutomation = vi.fn(async (): Promise<readonly RunRecord[]> => {
      throw new Error("dynamodb transport detail that must stay server-side");
    });
    const service = await makeService(listForAutomation);

    await expect(service.history(attacker, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND", message: "automation not found" }),
    );
    expect(listForAutomation).not.toHaveBeenCalled();

    await expect(service.history(owner, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "CONFLICT", message: "run history is temporarily unavailable" }),
    );
    expect(listForAutomation).toHaveBeenCalledWith(owner, "auto-1");
  });

  it("returns a sanitized 409 instead of a false 404 when history storage is unavailable", async () => {
    const service = await makeService(vi.fn(async (): Promise<readonly RunRecord[]> => {
      throw new Error("provider secret-ish transport text");
    }));
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs" },
      { scope: owner },
    );

    expect(response).toEqual({
      status: 409,
      body: { error: { code: "CONFLICT", message: "run history is temporarily unavailable" } },
    });
    expect(JSON.stringify(response.body)).not.toContain("provider secret-ish transport text");
  });

  it("preserves normal run-history summaries", async () => {
    const run: RunRecord = {
      tenantId: owner.tenantId,
      userId: owner.userId,
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 1,
      occurrenceKey: "auto-1:2026-08-25T00:10:00.000Z",
      status: "SUCCEEDED",
      scheduledAt: "2026-08-25T00:10:00.000Z",
      finishedAt: "2026-08-25T00:11:00.000Z",
    };
    const service = await makeService(vi.fn(async () => [run]));

    await expect(service.history(owner, "auto-1")).resolves.toEqual([
      expect.objectContaining({ runId: "run-1", status: "SUCCEEDED", runKind: "SCHEDULED" }),
    ]);
  });
});
