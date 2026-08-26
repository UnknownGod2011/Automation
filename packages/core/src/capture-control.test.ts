import { describe, expect, it } from "vitest";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  CaptureCollectionControlService,
  InMemoryCaptureCollectionControlStore,
  initialCaptureCollectionControlRecord,
} from "./capture-control.js";

const scope = { tenantId: "tenant-a", userId: "user-a" };

async function fixture(collectorReady?: boolean) {
  const sessions = new InMemoryCaptureSessionStore();
  const controls = new InMemoryCaptureCollectionControlStore();
  await sessions.putStarted({
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-a",
    captureSessionId: "capture-a",
    browserSessionId: "browser-a",
    browserProfileRef: "profile-a",
    startedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T01:00:00.000Z",
    status: "STARTED",
  });
  await controls.putInitial({
    ...initialCaptureCollectionControlRecord({
      scope,
      automationId: "automation-a",
      captureSessionId: "capture-a",
      updatedAt: "2026-08-21T00:00:00.000Z",
    }),
    ...(collectorReady !== undefined ? { collectorReady } : {}),
  });
  return {
    controls,
    service: new CaptureCollectionControlService(
      sessions,
      controls,
      () => new Date("2026-08-21T00:10:00.000Z"),
    ),
  };
}

const command = { scope, automationId: "automation-a", captureSessionId: "capture-a" };

describe("CaptureCollectionControlService", () => {
  it("persists AUTH_SETUP -> WORKFLOW -> finish with idempotent local/mock commands", async () => {
    const { service } = await fixture();
    await expect(service.getState(command)).resolves.toEqual({ phase: "AUTH_SETUP", finishRequested: false });
    await expect(service.startWorkflow(command)).resolves.toBe("UPDATED");
    await expect(service.startWorkflow(command)).resolves.toBe("REPLAY");
    await expect(service.getState(command)).resolves.toEqual({ phase: "WORKFLOW", finishRequested: false });
    await expect(service.finish(command)).resolves.toBe("UPDATED");
    await expect(service.finish(command)).resolves.toBe("REPLAY");
    await expect(service.getState(command)).resolves.toEqual({ phase: "WORKFLOW", finishRequested: true });
  });

  it("requires explicit production collector readiness before finish", async () => {
    const { controls, service } = await fixture(false);
    await expect(service.startWorkflow(command)).resolves.toBe("UPDATED");
    await expect(service.getState(command)).resolves.toEqual({
      phase: "WORKFLOW",
      finishRequested: false,
      collectorReady: false,
    });
    await expect(service.finish(command)).rejects.toThrow("collector is not ready");

    await expect(controls.markReady(scope, "capture-a", "2026-08-21T00:10:01.000Z"))
      .resolves.toBe("UPDATED");
    await expect(controls.markReady(scope, "capture-a", "2026-08-21T00:10:02.000Z"))
      .resolves.toBe("REPLAY");
    await expect(service.getState(command)).resolves.toEqual({
      phase: "WORKFLOW",
      finishRequested: false,
      collectorReady: true,
    });
    await expect(service.finish(command)).resolves.toBe("UPDATED");
  });

  it("rejects finish before workflow recording starts", async () => {
    const { service } = await fixture();
    await expect(service.finish(command)).rejects.toThrow(/must start/);
  });

  it("rejects another tenant before mutating durable control", async () => {
    const { controls, service } = await fixture();
    await expect(service.startWorkflow({
      ...command,
      scope: { tenantId: "tenant-b", userId: "user-a" },
    })).rejects.toThrow(/not found|ownership/);
    await expect(controls.getState(scope, "capture-a")).resolves.toEqual({ phase: "AUTH_SETUP", finishRequested: false });
  });

  it("rejects commands after the capture session expires", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    const controls = new InMemoryCaptureCollectionControlStore();
    await sessions.putStarted({
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: "automation-a",
      captureSessionId: "capture-a",
      browserSessionId: "browser-a",
      browserProfileRef: "profile-a",
      startedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2026-08-21T00:05:00.000Z",
      status: "STARTED",
    });
    await controls.putInitial(initialCaptureCollectionControlRecord({
      scope,
      automationId: "automation-a",
      captureSessionId: "capture-a",
      updatedAt: "2026-08-21T00:00:00.000Z",
    }));
    const service = new CaptureCollectionControlService(sessions, controls, () => new Date("2026-08-21T00:10:00.000Z"));
    await expect(service.startWorkflow(command)).rejects.toThrow(/expired/);
  });
});
