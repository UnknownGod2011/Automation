import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import type { OwnershipScope } from "./index.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Daily report",
    websiteUrl: "https://example.test/app",
    prompt: "Post the report",
    status: "ACTIVE",
    browserProfileRef: "profile-server-only",
    publishedWorkflowVersion: 1,
    schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}

function graph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "auto-1",
    automationId: "auto-1",
    version: 1,
    entryNodeId: "end",
    objective: "Post the report",
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
        timeoutMs: 1_000,
        escalation: "FAIL",
      },
    },
    createdAt: "2026-08-23T00:00:00.000Z",
  };
}

function lifecycle(record: AutomationRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => record),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => graph()),
    runFreshTest: vi.fn(async () => {
      throw new Error("unused");
    }),
    publish: vi.fn(async () => record),
    history: vi.fn(async () => []),
  };
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  const record = automation();
  await automations.put(record);
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: lifecycle(record),
    captureSessions,
    captureState,
    capabilities: {
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
    now: () => new Date("2026-08-23T01:00:00.000Z"),
  });
  return { automations, service };
}

describe("notification preference management", () => {
  it("updates only optional preferences under trusted ownership and keeps server-only fields out of the response", async () => {
    const { automations, service } = await setup();

    const result = await service.updateNotificationPreferences(owner, "auto-1", {
      notifyOnSuccess: true,
      notifyOnFailure: false,
    });

    expect(result.notifyOnSuccess).toBe(true);
    expect(result.notifyOnFailure).toBe(false);
    expect(result.updatedAt).toBe("2026-08-23T01:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("profile-server-only");
    const stored = await automations.get(owner, "auto-1");
    expect(stored).toMatchObject({
      notifyOnSuccess: true,
      notifyOnFailure: false,
      browserProfileRef: "profile-server-only",
      status: "ACTIVE",
      publishedWorkflowVersion: 1,
    });
  });

  it("is idempotent when preferences are unchanged", async () => {
    const { automations, service } = await setup();
    const put = vi.spyOn(automations, "put");

    const result = await service.updateNotificationPreferences(owner, "auto-1", {
      notifyOnSuccess: false,
      notifyOnFailure: true,
    });

    expect(result.updatedAt).toBe("2026-08-23T00:00:00.000Z");
    expect(put).not.toHaveBeenCalled();
  });

  it("cannot update another tenant's automation", async () => {
    const { automations, service } = await setup();
    const put = vi.spyOn(automations, "put");

    await expect(service.updateNotificationPreferences(attacker, "auto-1", {
      notifyOnSuccess: true,
      notifyOnFailure: false,
    })).rejects.toBeInstanceOf(ControlPlaneError);

    expect(put).not.toHaveBeenCalled();
    expect((await automations.get(owner, "auto-1"))?.notifyOnFailure).toBe(true);
  });

  it("requires both booleans and ignores spoofed ownership fields at the HTTP boundary", async () => {
    const { automations, service } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const missing = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/notifications",
      body: { notifyOnSuccess: true },
    }, { scope: owner });
    expect(missing.status).toBe(400);

    const updated = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/notifications",
      body: {
        tenantId: attacker.tenantId,
        userId: attacker.userId,
        notifyOnSuccess: true,
        notifyOnFailure: false,
      },
    }, { scope: owner });

    expect(updated.status).toBe(200);
    expect(await automations.get(attacker, "auto-1")).toBeNull();
    expect(await automations.get(owner, "auto-1")).toMatchObject({
      notifyOnSuccess: true,
      notifyOnFailure: false,
    });
  });
});
