import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
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
    name: "Capture HTTP redaction",
    websiteUrl: "https://example.test/app",
    prompt: "Capture the workflow",
    status: "DRAFT",
    browserProfileRef: "profile-server-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
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

describe("capture start HTTP redaction", () => {
  it("keeps the durable capture-session identity server-side", async () => {
    const automations = new InMemoryAutomationRepository();
    await automations.put(automation());
    const captureSessions: CaptureSessionStarter = {
      start: vi.fn(async () => ({
        kind: "READY" as const,
        captureSessionId: "capture-server-id",
        liveViewUrl: "https://live.example.test/session?sig=short-lived-capability",
        expiresAt: "2026-08-25T00:15:00.000Z",
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
        capture: "CONFIGURED",
        cloudExecution: "CONFIGURED",
        scheduling: "CONFIGURED",
        notifications: "CONFIGURED",
      },
    });
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/capture", body: {} },
      { scope: owner },
    );

    expect(response).toEqual({
      status: 201,
      body: {
        kind: "READY",
        liveViewUrl: "https://live.example.test/session?sig=short-lived-capability",
        expiresAt: "2026-08-25T00:15:00.000Z",
      },
    });
    expect(JSON.stringify(response)).not.toContain("capture-server-id");
    expect(JSON.stringify(response)).not.toContain("captureSessionId");
    expect(captureSessions.start).toHaveBeenCalledTimes(1);
    expect(captureSessions.start).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ automationId: "auto-1" }),
    );
  });
});
