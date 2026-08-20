import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
  type FreshTestExecutionPort,
} from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import type { OwnershipScope } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function record(): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    name: "Cloud test",
    websiteUrl: "https://example.test/app",
    prompt: "Perform the permitted test",
    status: "READY_TO_TEST",
    browserProfileRef: "profile-server-only",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };
}

function duplicateResult() {
  return {
    kind: "DUPLICATE" as const,
    run: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      runId: "test-1",
      automationId: "auto-1",
      workflowVersion: 1,
      occurrenceKey: "auto-1:test:test-1",
      status: "SUCCEEDED" as const,
      scheduledAt: "2026-08-20T10:01:00.000Z",
    },
    checkpoint: null,
  };
}

function lifecycle(): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => record()),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => {
      throw new Error("not used");
    }),
    runFreshTest: vi.fn(async () => duplicateResult()),
    publish: vi.fn(async () => record()),
    history: vi.fn(async () => []),
  };
}

async function service(
  cloudExecution: "CONFIGURED" | "LOCAL_MOCK",
  freshTests?: FreshTestExecutionPort,
) {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  await automations.put(record());
  const localLifecycle = lifecycle();
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  return {
    localLifecycle,
    controlPlane: new AutomationControlPlaneService({
      automations,
      runs,
      lifecycle: localLifecycle,
      captureSessions,
      captureState: new InMemoryCaptureSessionStore(),
      capabilities: {
        auth: "CONFIGURED",
        capture: "CONFIGURED",
        cloudExecution,
        scheduling: "CONFIGURED",
        notifications: "NOT_CONFIGURED",
      },
      ...(freshTests ? { freshTests } : {}),
    }),
  };
}

describe("production fresh-test execution boundary", () => {
  it("fails closed when cloud execution is configured without a trusted fresh-test executor", async () => {
    const { controlPlane, localLifecycle } = await service("CONFIGURED");

    await expect(
      controlPlane.runFreshTest(scope, "auto-1", { runId: "test-1" }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "NOT_CONFIGURED",
        message: "cloud fresh-test execution is not configured",
      }),
    );
    expect(localLifecycle.runFreshTest).not.toHaveBeenCalled();
  });

  it("routes configured production tests only through the trusted cloud execution port", async () => {
    const execute = vi.fn(async () => duplicateResult());
    const freshTests: FreshTestExecutionPort = { execute };
    const { controlPlane, localLifecycle } = await service("CONFIGURED", freshTests);

    await expect(
      controlPlane.runFreshTest(scope, "auto-1", {
        runId: "test-1",
        runtimeVariables: { note: "safe runtime value" },
      }),
    ).resolves.toEqual(duplicateResult());

    expect(execute).toHaveBeenCalledWith({
      scope,
      automationId: "auto-1",
      runId: "test-1",
      runtimeVariables: { note: "safe runtime value" },
    });
    expect(localLifecycle.runFreshTest).not.toHaveBeenCalled();
  });

  it("preserves the in-process fresh-test implementation only for local/mock mode", async () => {
    const execute = vi.fn(async () => duplicateResult());
    const { controlPlane, localLifecycle } = await service("LOCAL_MOCK", { execute });

    await expect(
      controlPlane.runFreshTest(scope, "auto-1", { runId: "test-1" }),
    ).resolves.toEqual(duplicateResult());

    expect(localLifecycle.runFreshTest).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
