import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import type { OwnershipScope } from "./index.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

const owner: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const attacker: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };

function existingAutomation(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "creation-attempt-1",
    name: "Daily invoice approval",
    websiteUrl: "https://example.com/app",
    prompt: "Approve invoices that satisfy the policy",
    status: "READY_TO_TEST",
    browserProfileRef: "server-only-profile-ref",
    notifyOnSuccess: true,
    notifyOnFailure: false,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:05:00.000Z",
    ...overrides,
  };
}

function lifecycle(record: AutomationRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => record),
    persistCapture: vi.fn(async () => { throw new Error("unused"); }),
    compile: vi.fn(async () => { throw new Error("unused"); }),
    runFreshTest: vi.fn(async () => { throw new Error("unused"); }),
    publish: vi.fn(async () => { throw new Error("unused"); }),
    history: vi.fn(async () => []),
  };
}

async function harness(record: AutomationRecord = existingAutomation()) {
  const automations = new InMemoryAutomationRepository();
  await automations.put(record);
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  const draftLifecycle = lifecycle(record);
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture is not configured" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: draftLifecycle,
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
  return { automations, draftLifecycle, service };
}

function replayCommand() {
  return {
    automationId: "creation-attempt-1",
    name: " Daily invoice approval ",
    websiteUrl: " https://example.com/app ",
    objective: " Approve invoices that satisfy the policy ",
    consentAcknowledged: true,
    notifyOnSuccess: false,
    notifyOnFailure: true,
  } as const;
}

describe("automation creation request replay", () => {
  it("returns the existing scoped automation for the same creation intent without lifecycle side effects", async () => {
    const { service, draftLifecycle } = await harness();

    const replay = await service.createAutomation(owner, replayCommand());

    expect(replay).toMatchObject({
      automationId: "creation-attempt-1",
      name: "Daily invoice approval",
      status: "READY_TO_TEST",
      notifyOnSuccess: true,
      notifyOnFailure: false,
    });
    expect(draftLifecycle.createDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(replay)).not.toContain("server-only-profile-ref");
  });

  it("keeps conflicting content under the same creation-attempt id as a conflict", async () => {
    const { service, draftLifecycle } = await harness();

    await expect(service.createAutomation(owner, {
      ...replayCommand(),
      objective: "Delete every invoice",
    })).rejects.toEqual(expect.objectContaining({ code: "CONFLICT" } satisfies Partial<ControlPlaneError>));
    expect(draftLifecycle.createDraft).not.toHaveBeenCalled();
  });

  it("converges an authenticated HTTP retry without accepting spoofed ownership fields", async () => {
    const { service, draftLifecycle } = await harness();
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations",
      body: {
        ...replayCommand(),
        tenantId: attacker.tenantId,
        userId: attacker.userId,
      },
    }, { scope: owner });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ automationId: "creation-attempt-1", status: "READY_TO_TEST" });
    expect(JSON.stringify(response.body)).not.toContain(attacker.tenantId);
    expect(JSON.stringify(response.body)).not.toContain(attacker.userId);
    expect(JSON.stringify(response.body)).not.toContain("server-only-profile-ref");
    expect(draftLifecycle.createDraft).not.toHaveBeenCalled();
  });
});
