import { describe, expect, it, vi } from "vitest";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

function rejectingLifecycle(): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => { throw new Error("unexpected create"); }),
    persistCapture: vi.fn(async () => { throw new Error("unexpected public capture persistence"); }),
    compile: vi.fn(async () => { throw new Error("unexpected compile"); }),
    runFreshTest: vi.fn(async () => { throw new Error("unexpected fresh test"); }),
    publish: vi.fn(async () => { throw new Error("unexpected publish"); }),
    history: vi.fn(async () => []),
  };
}

describe("authenticated control-plane capture trace boundary", () => {
  it("does not expose raw capture-trace ingestion to an authenticated end user", async () => {
    const lifecycle = rejectingLifecycle();
    const captureSessions: CaptureSessionStarter = {
      start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
    };
    const service = new AutomationControlPlaneService({
      automations: new InMemoryAutomationRepository(),
      runs: new InMemoryRunRepository(),
      lifecycle,
      captureSessions,
      captureState: new InMemoryCaptureSessionStore(),
      capabilities: {
        auth: "LOCAL_MOCK",
        capture: "LOCAL_MOCK",
        cloudExecution: "LOCAL_MOCK",
        scheduling: "LOCAL_MOCK",
        notifications: "LOCAL_MOCK",
      },
    });
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/capture-trace",
        body: {
          trace: {
            tenantId: "tenant-owner",
            userId: "user-owner",
            automationId: "auto-1",
            traceId: "forged-trace",
          },
        },
      },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response).toEqual({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "route not found" } },
    });
    expect(lifecycle.persistCapture).not.toHaveBeenCalled();
  });
});
