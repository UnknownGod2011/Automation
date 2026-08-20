import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, RunRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  type AutomationControlPlaneDependencies,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };
const dailySchedule = { kind: "DAILY" as const, expression: "0 9 * * *", timezone: "Asia/Kolkata" };

function automation(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Post daily report",
    websiteUrl: "https://example.test/app",
    prompt: "Post the daily report",
    status: "DRAFT",
    browserProfileRef: "profile-secret-server-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

function graph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "wf-1",
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
    createdAt: "2026-08-19T12:00:00.000Z",
  };
}

function makeLifecycle(record: AutomationRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async (request) => ({
      ...record,
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      automationId: request.automationId,
      name: request.name,
      websiteUrl: request.websiteUrl,
      prompt: request.objective,
    })),
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
        scheduledAt: "2026-08-19T12:01:00.000Z",
      },
      checkpoint: null,
    })),
    publish: vi.fn(async () => ({
      ...record,
      status: "ACTIVE" as const,
      publishedWorkflowVersion: 1,
      schedule: dailySchedule,
    })),
    history: vi.fn(async () => []),
  };
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  const record = automation();
  await automations.put(record);
  const lifecycle = makeLifecycle(record);
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({
      kind: "NOT_CONFIGURED" as const,
      reason: "AgentCore capture is not configured",
    })),
  };
  const scheduleLifecycle: NonNullable<AutomationControlPlaneDependencies["scheduleLifecycle"]> = {
    updateSchedule: vi.fn(async (request) => ({
      ...record,
      status: "ACTIVE" as const,
      publishedWorkflowVersion: 1,
      schedule: request.schedule,
    })),
    pause: vi.fn(async () => ({
      ...record,
      status: "PAUSED" as const,
      publishedWorkflowVersion: 1,
      schedule: dailySchedule,
    })),
    resume: vi.fn(async () => ({
      ...record,
      status: "ACTIVE" as const,
      publishedWorkflowVersion: 1,
      schedule: dailySchedule,
    })),
    disable: vi.fn(async () => ({
      ...record,
      status: "DISABLED" as const,
      publishedWorkflowVersion: 1,
      schedule: dailySchedule,
    })),
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
      scheduling: "LOCAL_MOCK",
      notifications: "NOT_CONFIGURED",
    },
  });
  return { automations, runs, lifecycle, captureSessions, captureState, scheduleLifecycle, service, record };
}

describe("AutomationControlPlaneService", () => {
  it("returns dashboard-safe automation data without server-owned browser profile references", async () => {
    const { runs, service } = await setup();
    const run: RunRecord = {
      tenantId: owner.tenantId,
      userId: owner.userId,
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 1,
      occurrenceKey: "auto-1:2026-08-19T12:05:00.000Z",
      status: "WAITING_FOR_HUMAN",
      scheduledAt: "2026-08-19T12:05:00.000Z",
    };
    await runs.createIfAbsent(run);

    const dashboard = await service.dashboard(owner);

    expect(dashboard.capabilities.capture).toBe("NOT_CONFIGURED");
    expect(dashboard.automations).toHaveLength(1);
    expect(dashboard.automations[0]?.needsAttention).toBe(true);
    expect(JSON.stringify(dashboard)).not.toContain("profile-secret-server-ref");
  });

  it("surfaces only safe latest-completed capture metadata for compile readiness", async () => {
    const { captureState, service } = await setup();
    await captureState.putStarted({
      tenantId: owner.tenantId,
      userId: owner.userId,
      automationId: "auto-1",
      captureSessionId: "capture-1",
      browserSessionId: "browser-session-secret",
      browserProfileRef: "profile-secret-server-ref",
      startedAt: "2026-08-19T12:00:00.000Z",
      expiresAt: "2026-08-19T13:00:00.000Z",
      status: "STARTED",
    });
    await captureState.complete(
      owner,
      "capture-1",
      "trace-ready-1",
      "2026-08-19T12:10:00.000Z",
    );

    const summary = await service.getAutomation(owner, "auto-1");

    expect(summary.latestCompletedCapture).toEqual({
      traceId: "trace-ready-1",
      completedAt: "2026-08-19T12:10:00.000Z",
    });
    expect(JSON.stringify(summary)).not.toContain("browser-session-secret");
    expect(JSON.stringify(summary)).not.toContain("profile-secret-server-ref");
  });

  it("keeps tenant scope server-side and cannot read another tenant automation", async () => {
    const { service } = await setup();
    await expect(service.getAutomation(attacker, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("surfaces capture as an explicit NOT_CONFIGURED product state", async () => {
    const { service, captureSessions } = await setup();

    await expect(service.beginCapture(owner, "auto-1")).resolves.toEqual({
      kind: "NOT_CONFIGURED",
      reason: "AgentCore capture is not configured",
    });
    expect(captureSessions.start).toHaveBeenCalledWith(owner, expect.objectContaining({ automationId: "auto-1" }));
  });

  it("rejects duplicate automation identifiers before lifecycle side effects", async () => {
    const { service, lifecycle } = await setup();

    await expect(
      service.createAutomation(owner, {
        automationId: "auto-1",
        name: "Duplicate",
        websiteUrl: "https://example.test",
        objective: "Duplicate",
        consentAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(ControlPlaneError);
    expect(lifecycle.createDraft).not.toHaveBeenCalled();
  });

  it("routes schedule lifecycle mutations through trusted ownership scope and returns sanitized summaries", async () => {
    const { service, scheduleLifecycle } = await setup();

    const paused = await service.pauseAutomation(owner, "auto-1");
    const updated = await service.updateAutomationSchedule(owner, "auto-1", {
      schedule: { kind: "WEEKLY", expression: "0 9 * * 1", timezone: "Asia/Kolkata" },
    });

    expect(scheduleLifecycle.pause).toHaveBeenCalledWith({ scope: owner, automationId: "auto-1" });
    expect(scheduleLifecycle.updateSchedule).toHaveBeenCalledWith({
      scope: owner,
      automationId: "auto-1",
      schedule: { kind: "WEEKLY", expression: "0 9 * * 1", timezone: "Asia/Kolkata" },
    });
    expect(paused.status).toBe("PAUSED");
    expect(updated.schedule?.kind).toBe("WEEKLY");
    expect(JSON.stringify([paused, updated])).not.toContain("profile-secret-server-ref");
  });
});

describe("AutomationControlPlaneHttpHandler", () => {
  it("uses authenticated context rather than spoofable ownership fields in request JSON", async () => {
    const { automations, runs, lifecycle, captureSessions, captureState, scheduleLifecycle } = await setup();
    const emptyAutomations = new InMemoryAutomationRepository();
    const service = new AutomationControlPlaneService({
      automations: emptyAutomations,
      runs,
      lifecycle,
      captureSessions,
      captureState,
      scheduleLifecycle,
      capabilities: {
        auth: "LOCAL_MOCK",
        capture: "NOT_CONFIGURED",
        cloudExecution: "LOCAL_MOCK",
        scheduling: "LOCAL_MOCK",
        notifications: "NOT_CONFIGURED",
      },
    });
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations",
        body: {
          tenantId: attacker.tenantId,
          userId: attacker.userId,
          automationId: "auto-new",
          name: "Safe draft",
          websiteUrl: "https://example.test/app",
          objective: "Do the permitted task",
          consentAcknowledged: true,
        },
      },
      { scope: owner },
    );

    expect(response.status).toBe(201);
    expect(lifecycle.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ scope: owner, automationId: "auto-new" }),
    );
    expect(JSON.stringify(response.body)).not.toContain("profile-secret-server-ref");
    expect(await automations.get(owner, "auto-1")).not.toBeNull();
  });

  it("returns a stable 503 NOT_CONFIGURED response for cloud capture without leaking internals", async () => {
    const { service } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/capture" },
      { scope: owner },
    );

    expect(response).toEqual({
      status: 503,
      body: { kind: "NOT_CONFIGURED", reason: "AgentCore capture is not configured" },
    });
  });

  it("sanitizes unexpected service failures instead of returning raw exception text", async () => {
    const { service } = await setup();
    vi.spyOn(service, "dashboard").mockRejectedValueOnce(new Error("secret provider response"));
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle({ method: "GET", path: "/v1/automations" }, { scope: owner });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("secret provider response");
    expect(response.body).toEqual({
      error: { code: "INTERNAL", message: "control-plane request failed" },
    });
  });

  it("validates schedule shape before invoking publish", async () => {
    const { service, lifecycle } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/publish",
        body: {
          workflowVersion: 1,
          schedule: { kind: "WHATEVER", expression: "* * * * *", timezone: "UTC" },
        },
      },
      { scope: owner },
    );

    expect(response.status).toBe(400);
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it("exposes pause/resume/disable and schedule update without accepting spoofed ownership", async () => {
    const { service, scheduleLifecycle } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const pause = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/pause",
        body: { tenantId: attacker.tenantId, userId: attacker.userId },
      },
      { scope: owner },
    );
    const schedule = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/schedule",
        body: {
          tenantId: attacker.tenantId,
          userId: attacker.userId,
          schedule: { kind: "DAILY", expression: "08:30", timezone: "Asia/Kolkata" },
        },
      },
      { scope: owner },
    );

    expect(pause.status).toBe(200);
    expect(schedule.status).toBe(200);
    expect(scheduleLifecycle.pause).toHaveBeenCalledWith({ scope: owner, automationId: "auto-1" });
    expect(scheduleLifecycle.updateSchedule).toHaveBeenCalledWith({
      scope: owner,
      automationId: "auto-1",
      schedule: { kind: "DAILY", expression: "08:30", timezone: "Asia/Kolkata" },
    });
  });
});
