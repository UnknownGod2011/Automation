import { describe, expect, it } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import type { OwnershipScope } from "./index.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

const owner: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const attacker: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };

function published(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "automation-1",
    name: "Reusable note",
    websiteUrl: "https://example.test/app",
    prompt: "Submit the reusable note",
    status: "ACTIVE",
    publishedWorkflowVersion: 3,
    browserProfileRef: "profile-server-only",
    schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
    scheduledNonSecretInputs: {
      capture_input_2: "old-customer",
      capture_input_7: "old-note",
    },
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
    ...overrides,
  };
}

function unusedLifecycle(): AutomationLifecyclePort {
  const unavailable = async (): Promise<never> => { throw new Error("unused lifecycle method"); };
  return {
    createDraft: unavailable,
    persistCapture: unavailable,
    compile: unavailable,
    runFreshTest: unavailable,
    publish: unavailable,
    history: async () => [],
  };
}

async function setup(record: AutomationRecord = published()) {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  await automations.put(record);
  const captureSessions: CaptureSessionStarter = {
    start: async () => ({ kind: "NOT_CONFIGURED", reason: "capture is not configured" }),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: unusedLifecycle(),
    captureSessions,
    captureState,
    capabilities: {
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
    now: () => new Date("2026-08-23T14:00:00.000Z"),
  });
  return { automations, service };
}

describe("scheduled input management", () => {
  it("replaces the complete write-only input set for future ACTIVE runs without exposing values", async () => {
    const { automations, service } = await setup();

    const summary = await service.updateScheduledInputValues(owner, "automation-1", {
      scheduledNonSecretInputs: {
        capture_input_2: "new-customer",
        capture_input_7: "new-note",
      },
      scheduledInputsAreNonSecret: true,
    });

    expect((await automations.get(owner, "automation-1"))?.scheduledNonSecretInputs).toEqual({
      capture_input_2: "new-customer",
      capture_input_7: "new-note",
    });
    expect(summary.status).toBe("ACTIVE");
    expect(summary.updatedAt).toBe("2026-08-23T14:00:00.000Z");
    expect(JSON.stringify(summary)).not.toContain("new-customer");
    expect(JSON.stringify(summary)).not.toContain("new-note");
    expect(JSON.stringify(summary)).not.toContain("profile-server-only");
  });

  it("allows PAUSED updates but rejects forged key sets, missing acknowledgement, and non-live authoring states", async () => {
    const paused = await setup(published({ status: "PAUSED" }));
    await expect(paused.service.updateScheduledInputValues(owner, "automation-1", {
      scheduledNonSecretInputs: { capture_input_2: "customer", capture_input_7: "note" },
      scheduledInputsAreNonSecret: true,
    })).resolves.toEqual(expect.objectContaining({ status: "PAUSED" }));

    await expect(paused.service.updateScheduledInputValues(owner, "automation-1", {
      scheduledNonSecretInputs: { capture_input_2: "customer", capture_input_9: "forged" },
      scheduledInputsAreNonSecret: true,
    })).rejects.toEqual(expect.objectContaining({ code: "BAD_REQUEST" }));
    await expect(paused.service.updateScheduledInputValues(owner, "automation-1", {
      scheduledNonSecretInputs: { capture_input_2: "customer", capture_input_7: "note" },
      scheduledInputsAreNonSecret: false,
    })).rejects.toEqual(expect.objectContaining({ code: "BAD_REQUEST" }));

    const revising = await setup(published({ status: "READY_TO_TEST" }));
    await expect(revising.service.updateScheduledInputValues(owner, "automation-1", {
      scheduledNonSecretInputs: { capture_input_2: "customer", capture_input_7: "note" },
      scheduledInputsAreNonSecret: true,
    })).rejects.toEqual(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("keeps ownership server-side in the HTTP route and rejects cross-tenant updates", async () => {
    const { automations, service } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations/automation-1/scheduled-inputs",
      body: {
        tenantId: attacker.tenantId,
        userId: attacker.userId,
        scheduledNonSecretInputs: {
          capture_input_2: "http-customer",
          capture_input_7: "http-note",
        },
        scheduledInputsAreNonSecret: true,
      },
    }, { scope: owner });

    expect(response.status).toBe(200);
    expect((await automations.get(owner, "automation-1"))?.scheduledNonSecretInputs).toEqual({
      capture_input_2: "http-customer",
      capture_input_7: "http-note",
    });
    expect(JSON.stringify(response.body)).not.toContain("http-customer");
    expect(JSON.stringify(response.body)).not.toContain(attacker.tenantId);

    await expect(service.updateScheduledInputValues(attacker, "automation-1", {
      scheduledNonSecretInputs: { capture_input_2: "x", capture_input_7: "y" },
      scheduledInputsAreNonSecret: true,
    })).rejects.toEqual(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("rejects malformed HTTP payloads before persistence", async () => {
    const { automations, service } = await setup();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const missingAck = await handler.handle({
      method: "POST",
      path: "/v1/automations/automation-1/scheduled-inputs",
      body: { scheduledNonSecretInputs: { capture_input_2: "customer", capture_input_7: "note" } },
    }, { scope: owner });
    const oversized = await handler.handle({
      method: "POST",
      path: "/v1/automations/automation-1/scheduled-inputs",
      body: {
        scheduledNonSecretInputs: { capture_input_2: "x".repeat(4_097), capture_input_7: "note" },
        scheduledInputsAreNonSecret: true,
      },
    }, { scope: owner });

    expect(missingAck.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect((await automations.get(owner, "automation-1"))?.scheduledNonSecretInputs).toEqual({
      capture_input_2: "old-customer",
      capture_input_7: "old-note",
    });
  });
});
