import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
  type ControlPlaneCapabilityState,
} from "./control-plane.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Capture capability",
    websiteUrl: "https://example.test/app",
    prompt: "Capture the workflow",
    status: "DRAFT",
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
    runFreshTest: async () => { throw new Error("unused runFreshTest"); },
    publish: async () => { throw new Error("unused publish"); },
    history: async () => [],
  };
}

async function setup(capture: ControlPlaneCapabilityState) {
  const automations = new InMemoryAutomationRepository();
  await automations.put(automation());
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({
      kind: "READY" as const,
      captureSessionId: "capture-server-id",
      liveViewUrl: "https://live.example.test/session?sig=secret-capability",
      expiresAt: "2026-08-24T00:15:00.000Z",
    })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs: new InMemoryRunRepository(),
    lifecycle: lifecycle(),
    captureSessions,
    captureState: {
      latestCompletedForAutomation: vi.fn(async () => null),
    },
    capabilities: {
      auth: "CONFIGURED",
      capture,
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
  });
  return { service, captureSessions };
}

describe("Capture capability dispatch", () => {
  it("fails closed before browser-session allocation when capture is NOT_CONFIGURED", async () => {
    const { service, captureSessions } = await setup("NOT_CONFIGURED");

    await expect(service.beginCapture(owner, "auto-1")).resolves.toEqual({
      kind: "NOT_CONFIGURED",
      reason: "cloud capture is not configured",
    });

    expect(captureSessions.start).not.toHaveBeenCalled();
  });

  it("returns HTTP 503 without calling the capture starter when capture is NOT_CONFIGURED", async () => {
    const { service, captureSessions } = await setup("NOT_CONFIGURED");
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/capture" },
      { scope: owner },
    );

    expect(response).toEqual({
      status: 503,
      body: {
        kind: "NOT_CONFIGURED",
        reason: "cloud capture is not configured",
      },
    });
    expect(captureSessions.start).not.toHaveBeenCalled();
  });

  it.each(["CONFIGURED", "LOCAL_MOCK"] as const)(
    "uses the configured capture starter when capture is %s",
    async (capture) => {
      const { service, captureSessions } = await setup(capture);

      await expect(service.beginCapture(owner, "auto-1")).resolves.toEqual({
        kind: "READY",
        captureSessionId: "capture-server-id",
        liveViewUrl: "https://live.example.test/session?sig=secret-capability",
        expiresAt: "2026-08-24T00:15:00.000Z",
      });

      expect(captureSessions.start).toHaveBeenCalledTimes(1);
      expect(captureSessions.start).toHaveBeenCalledWith(owner, expect.objectContaining({ automationId: "auto-1" }));
    },
  );
});
