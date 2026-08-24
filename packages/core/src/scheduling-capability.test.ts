import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  type AutomationControlPlaneDependencies,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import type { OwnershipScope } from "./index.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };
const schedule = { kind: "DAILY" as const, expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" };

function record(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Daily report",
    websiteUrl: "https://example.test/app",
    prompt: "Post the daily report",
    status: "READY_TO_PUBLISH",
    browserProfileRef: "profile-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

function graph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "auto-1",
    automationId: "auto-1",
    version: 1,
    entryNodeId: "end",
    objective: "Post the daily report",
    nodes: {
      end: {
        id: "end",
        kind: "END",
        objective: "Done",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: false,
          retryableFailureCodes: [],
        },
        timeoutMs: 1000,
        escalation: "FAIL",
      },
    },
    createdAt: "2026-08-24T00:00:00.000Z",
  };
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  const automation = record();
  await automations.put(automation);
  const lifecycle: AutomationLifecyclePort = {
    createDraft: vi.fn(async () => automation),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => graph()),
    runFreshTest: vi.fn(async () => ({
      kind: "DUPLICATE" as const,
      run: {
        tenantId: owner.tenantId,
        userId: owner.userId,
        runId: "test-1",
        automationId: "auto-1",
        workflowVersion: 1,
        occurrenceKey: "auto-1:test:test-1",
        status: "SUCCEEDED" as const,
        scheduledAt: "2026-08-24T00:01:00.000Z",
      },
      checkpoint: null,
    })),
    publish: vi.fn(async () => ({
      ...automation,
      status: "ACTIVE" as const,
      publishedWorkflowVersion: 1,
      schedule,
    })),
    history: vi.fn(async () => []),
  };
  const scheduleLifecycle: NonNullable<AutomationControlPlaneDependencies["scheduleLifecycle"]> = {
    updateSchedule: vi.fn(async (request) => ({ ...automation, status: "ACTIVE" as const, publishedWorkflowVersion: 1, schedule: request.schedule })),
    pause: vi.fn(async () => ({ ...automation, status: "PAUSED" as const, publishedWorkflowVersion: 1, schedule })),
    resume: vi.fn(async () => ({ ...automation, status: "ACTIVE" as const, publishedWorkflowVersion: 1, schedule })),
    disable: vi.fn(async () => ({ ...automation, status: "DISABLED" as const, publishedWorkflowVersion: 1, schedule })),
  };
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture is not configured" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle,
    captureSessions,
    captureState,
    scheduleLifecycle,
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "NOT_CONFIGURED",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "NOT_CONFIGURED",
      notifications: "NOT_CONFIGURED",
    },
  });
  return { service, lifecycle, scheduleLifecycle };
}

describe("scheduling capability admission", () => {
  it("rejects publish before scheduler mutation when scheduling is NOT_CONFIGURED", async () => {
    const { service, lifecycle } = await setup();

    await expect(service.publishAutomation(owner, "auto-1", { workflowVersion: 1, schedule })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_CONFIGURED", message: "automation scheduling is not configured" }),
    );
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it("rejects schedule management before schedule adapter mutation when scheduling is NOT_CONFIGURED", async () => {
    const { service, scheduleLifecycle } = await setup();

    await expect(service.updateAutomationSchedule(owner, "auto-1", { schedule })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_CONFIGURED" }),
    );
    await expect(service.pauseAutomation(owner, "auto-1")).rejects.toEqual(expect.objectContaining({ code: "NOT_CONFIGURED" }));
    await expect(service.resumeAutomation(owner, "auto-1")).rejects.toEqual(expect.objectContaining({ code: "NOT_CONFIGURED" }));
    await expect(service.disableAutomation(owner, "auto-1")).rejects.toEqual(expect.objectContaining({ code: "NOT_CONFIGURED" }));

    expect(scheduleLifecycle.updateSchedule).not.toHaveBeenCalled();
    expect(scheduleLifecycle.pause).not.toHaveBeenCalled();
    expect(scheduleLifecycle.resume).not.toHaveBeenCalled();
    expect(scheduleLifecycle.disable).not.toHaveBeenCalled();
  });

  it("does not reveal scheduling capability for a cross-tenant automation lookup", async () => {
    const { service, lifecycle, scheduleLifecycle } = await setup();

    await expect(service.publishAutomation(attacker, "auto-1", { workflowVersion: 1, schedule })).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    await expect(service.pauseAutomation(attacker, "auto-1")).rejects.toEqual(expect.objectContaining({ code: "NOT_FOUND" }));

    expect(lifecycle.publish).not.toHaveBeenCalled();
    expect(scheduleLifecycle.pause).not.toHaveBeenCalled();
  });
});
