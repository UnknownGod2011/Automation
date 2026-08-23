import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import {
  AutomationControlPlaneHttpHandler,
} from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  type AutomationControlPlaneDependencies,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Fresh test capability",
    websiteUrl: "https://example.test/app",
    prompt: "Verify the captured workflow before publish",
    status: "READY_TO_TEST",
    browserProfileRef: "profile-server-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

function lifecycle(): AutomationLifecyclePort {
  return {
    createDraft: async () => { throw new Error("unused createDraft"); },
    persistCapture: async () => { throw new Error("unused persistCapture"); },
    compile: async () => { throw new Error("unused compile"); },
    runFreshTest: async (request) => ({
      kind: "DUPLICATE",
      run: {
        tenantId: request.scope.tenantId,
        userId: request.scope.userId,
        runId: request.runId,
        automationId: request.automationId,
        workflowVersion: 1,
        occurrenceKey: `${request.automationId}:test:${request.runId}`,
        status: "SUCCEEDED",
        scheduledAt: "2026-08-24T00:01:00.000Z",
      },
      checkpoint: null,
    }),
    publish: async () => { throw new Error("unused publish"); },
    history: async () => [],
  };
}

async function setup(cloudExecution: "LOCAL_MOCK" | "NOT_CONFIGURED") {
  const automations = new InMemoryAutomationRepository();
  await automations.put(automation());
  const localLifecycle = lifecycle();
  const localFreshTest = vi.spyOn(localLifecycle, "runFreshTest");
  const freshTests: NonNullable<AutomationControlPlaneDependencies["freshTests"]> = {
    execute: vi.fn(async (request) => ({ kind: "ACCEPTED" as const, runId: request.runId })),
  };
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unused" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs: new InMemoryRunRepository(),
    lifecycle: localLifecycle,
    captureSessions,
    captureState: {
      latestCompletedForAutomation: vi.fn(async () => null),
    },
    freshTests,
    capabilities: {
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution,
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
  });
  return { service, localFreshTest, freshTests };
}

describe("Fresh Test capability dispatch", () => {
  it("fails closed when cloud execution is NOT_CONFIGURED instead of running the local lifecycle", async () => {
    const { service, localFreshTest, freshTests } = await setup("NOT_CONFIGURED");

    await expect(service.runFreshTest(owner, "auto-1", { runId: "test-not-configured" })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_CONFIGURED" }),
    );

    expect(localFreshTest).not.toHaveBeenCalled();
    expect(freshTests.execute).not.toHaveBeenCalled();
  });

  it("returns a sanitized HTTP 503 without invoking any execution path when cloud execution is NOT_CONFIGURED", async () => {
    const { service, localFreshTest, freshTests } = await setup("NOT_CONFIGURED");
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/test",
        body: { runId: "test-not-configured" },
      },
      { scope: owner },
    );

    expect(response).toEqual({
      status: 503,
      body: {
        error: {
          code: "NOT_CONFIGURED",
          message: "fresh-test execution is not configured",
        },
      },
    });
    expect(localFreshTest).not.toHaveBeenCalled();
    expect(freshTests.execute).not.toHaveBeenCalled();
  });

  it("uses the in-process lifecycle only when cloud execution is explicitly LOCAL_MOCK", async () => {
    const { service, localFreshTest, freshTests } = await setup("LOCAL_MOCK");

    await expect(service.runFreshTest(owner, "auto-1", { runId: "test-local" })).resolves.toEqual(
      expect.objectContaining({ kind: "DUPLICATE" }),
    );

    expect(localFreshTest).toHaveBeenCalledTimes(1);
    expect(localFreshTest).toHaveBeenCalledWith({
      scope: owner,
      automationId: "auto-1",
      runId: "test-local",
    });
    expect(freshTests.execute).not.toHaveBeenCalled();
  });
});
