import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };

function record(): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-unsupported",
    name: "Unsupported control capture",
    websiteUrl: "https://example.test/form",
    prompt: "Submit the demonstrated form",
    status: "COMPILING",
    browserProfileRef: "profile-server-only",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:10:00.000Z",
  };
}

async function makeService(compileError: Error) {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  await automations.put(record());
  await captureState.putStarted({
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-unsupported",
    captureSessionId: "capture-server-only",
    browserSessionId: "browser-server-only",
    browserProfileRef: "profile-server-only",
    startedAt: "2026-08-26T12:00:00.000Z",
    expiresAt: "2026-08-26T13:00:00.000Z",
    status: "STARTED",
  });
  await captureState.complete(
    scope,
    "capture-server-only",
    "trace-server-only",
    "2026-08-26T12:09:00.000Z",
  );

  const lifecycle = {
    compile: vi.fn(async () => {
      throw compileError;
    }),
  } as unknown as AutomationLifecyclePort;
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "not used" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle,
    captureSessions,
    captureState,
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "LOCAL_MOCK",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "LOCAL_MOCK",
      notifications: "NOT_CONFIGURED",
    },
  });
  return { lifecycle, service };
}

describe("unsupported captured control compile feedback", () => {
  it("maps the closed compiler failure to an actionable sanitized control-plane code", async () => {
    const { lifecycle, service } = await makeService(
      new Error("capture input event 'internal-event-id' uses unsupported checkbox control"),
    );

    await expect(service.compileAutomation(scope, "auto-unsupported")).rejects.toEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_CAPTURE_CONTROL",
        message: "capture includes a form control that is not supported for safe replay",
      }),
    );
    expect(lifecycle.compile).toHaveBeenCalledTimes(1);
  });

  it("keeps unrelated compiler failures generic and does not expose internal detail", async () => {
    const { service } = await makeService(new Error("selector secret and internal compiler detail"));

    await expect(service.compileAutomation(scope, "auto-unsupported")).rejects.toEqual(
      expect.objectContaining({
        code: "CONFLICT",
        message: "automation could not be compiled from the latest capture",
      }),
    );
  });

  it("preserves the closed error code through the authenticated HTTP boundary", async () => {
    const { service } = await makeService(
      new Error("capture input event 'private-event' uses unsupported file control"),
    );
    const response = await new AutomationControlPlaneHttpHandler(service).handle(
      { method: "POST", path: "/v1/automations/auto-unsupported/compile", body: {} },
      { scope },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: {
          code: "UNSUPPORTED_CAPTURE_CONTROL",
          message: "capture includes a form control that is not supported for safe replay",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("private-event");
  });
});
