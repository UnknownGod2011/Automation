import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import {
  AutomationControlPlaneService,
  type AutomationControlPlaneDependencies,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function automation(status: AutomationRecord["status"]): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Fresh test admission",
    websiteUrl: "https://example.test/app",
    prompt: "Verify the captured workflow before publish",
    status,
    browserProfileRef: "profile-server-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

function unusedLifecycle(): AutomationLifecyclePort {
  const fail = async (): Promise<never> => {
    throw new Error("local lifecycle must not execute in cloud mode");
  };
  return {
    createDraft: vi.fn(fail),
    persistCapture: vi.fn(fail),
    compile: vi.fn(fail),
    runFreshTest: vi.fn(fail),
    publish: vi.fn(fail),
    history: vi.fn(async () => []),
  };
}

async function setup(status: AutomationRecord["status"]) {
  const automations = new InMemoryAutomationRepository();
  await automations.put(automation(status));
  const freshTests: NonNullable<AutomationControlPlaneDependencies["freshTests"]> = {
    execute: vi.fn(async (request) => ({ kind: "ACCEPTED" as const, runId: request.runId })),
  };
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unused" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs: new InMemoryRunRepository(),
    lifecycle: unusedLifecycle(),
    captureSessions,
    captureState: {
      latestCompletedForAutomation: vi.fn(async () => null),
    },
    freshTests,
    capabilities: {
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
  });
  return { service, freshTests };
}

describe("cloud Fresh Test control-plane admission", () => {
  it("rejects non-test-ready automation state before AgentCore execution-plane invocation", async () => {
    const { service, freshTests } = await setup("DRAFT");

    await expect(service.runFreshTest(owner, "auto-1", { runId: "test-blocked" })).rejects.toEqual(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(freshTests.execute).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant Fresh Test requests before execution-plane invocation", async () => {
    const { service, freshTests } = await setup("READY_TO_TEST");

    await expect(service.runFreshTest(attacker, "auto-1", { runId: "test-attacker" })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(freshTests.execute).not.toHaveBeenCalled();
  });

  it("submits an authenticated test-ready automation with the same bounded request identity", async () => {
    const { service, freshTests } = await setup("READY_TO_TEST");
    const runtimeVariables = { capture_input_1: "non-secret demo value" };

    await expect(
      service.runFreshTest(owner, "auto-1", { runId: "test-ready", runtimeVariables }),
    ).resolves.toEqual({ kind: "ACCEPTED", runId: "test-ready" });

    expect(freshTests.execute).toHaveBeenCalledTimes(1);
    expect(freshTests.execute).toHaveBeenCalledWith({
      scope: owner,
      automationId: "auto-1",
      runId: "test-ready",
      runtimeVariables,
    });
  });
});
