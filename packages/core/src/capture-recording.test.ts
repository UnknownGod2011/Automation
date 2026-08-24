import { describe, expect, it, vi } from "vitest";
import {
  CaptureCollectionControlService,
  InMemoryCaptureCollectionControlStore,
  initialCaptureCollectionControlRecord,
} from "./capture-control.js";
import { InMemoryCaptureSessionStore, type CaptureSessionRecord } from "./capture-completion.js";
import {
  CaptureAwareControlPlaneHttpHandler,
  CaptureRecordingControlPlaneService,
  type ActiveCaptureSessionStore,
  type CaptureCollectionTaskStarter,
  type ControlPlaneHttpHandlerPort,
} from "./capture-recording.js";
import type { OwnershipScope } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };
const record: CaptureSessionRecord = {
  tenantId: owner.tenantId,
  userId: owner.userId,
  automationId: "auto-1",
  captureSessionId: "capture-1",
  browserSessionId: "browser-session-secret",
  browserProfileRef: "browser-profile-secret",
  startedAt: "2026-08-21T00:00:00.000Z",
  expiresAt: "2026-08-21T01:00:00.000Z",
  status: "STARTED",
};

async function setup(taskStarter?: CaptureCollectionTaskStarter) {
  const durableSessions = new InMemoryCaptureSessionStore();
  const controls = new InMemoryCaptureCollectionControlStore();
  await durableSessions.putStarted(record);
  await controls.putInitial(initialCaptureCollectionControlRecord({
    scope: owner,
    automationId: record.automationId,
    captureSessionId: record.captureSessionId,
    updatedAt: record.startedAt,
  }));
  let activeRecord: CaptureSessionRecord | null = structuredClone(record);
  const sessions: ActiveCaptureSessionStore = {
    async activeForAutomation(scope, automationId) {
      if (scope.tenantId !== owner.tenantId || scope.userId !== owner.userId || automationId !== record.automationId) return null;
      return activeRecord?.status === "STARTED" ? structuredClone(activeRecord) : null;
    },
    async cancel(scope, captureSessionId, canceledAt) {
      if (scope.tenantId !== owner.tenantId || scope.userId !== owner.userId || captureSessionId !== record.captureSessionId) {
        throw new Error("capture session not found");
      }
      if (!activeRecord || activeRecord.status === "CANCELED") return "REPLAY";
      activeRecord = { ...activeRecord, status: "CANCELED", canceledAt };
      return "CANCELED";
    },
  };
  const control = new CaptureCollectionControlService(
    durableSessions,
    controls,
    () => new Date("2026-08-21T00:10:00.000Z"),
  );
  const stop = vi.fn(async () => undefined);
  return {
    service: new CaptureRecordingControlPlaneService(
      sessions,
      control,
      taskStarter,
      { stop },
      () => new Date("2026-08-21T00:20:00.000Z"),
    ),
    controls,
    stop,
  };
}

describe("CaptureRecordingControlPlaneService", () => {
  it("returns only the bounded active capture control view", async () => {
    const { service } = await setup();
    const state = await service.state(owner, "auto-1");

    expect(state).toEqual({
      kind: "ACTIVE",
      captureSessionId: "capture-1",
      phase: "AUTH_SETUP",
      finishRequested: false,
      expiresAt: "2026-08-21T01:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toContain("browser-session-secret");
    expect(JSON.stringify(state)).not.toContain("browser-profile-secret");
  });

  it("drives AUTH_SETUP to workflow recording and then a replay-safe finish request", async () => {
    const { service } = await setup();
    const command = { scope: owner, automationId: "auto-1", captureSessionId: "capture-1" };

    await expect(service.startWorkflow(command)).resolves.toMatchObject({
      kind: "ACTIVE",
      phase: "WORKFLOW",
      finishRequested: false,
    });
    await expect(service.finish(command)).resolves.toMatchObject({
      kind: "ACTIVE",
      phase: "WORKFLOW",
      finishRequested: true,
    });
    await expect(service.finish(command)).resolves.toMatchObject({ finishRequested: true });
  });

  it("launches the cloud collector after the durable WORKFLOW transition and retries launch on replay", async () => {
    const start = vi.fn(async () => undefined);
    const { service, controls } = await setup({ start });
    const command = { scope: owner, automationId: "auto-1", captureSessionId: "capture-1" };

    await service.startWorkflow(command);
    await service.startWorkflow(command);

    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith(command);
    await expect(controls.getState(owner, "capture-1")).resolves.toEqual({
      phase: "WORKFLOW",
      finishRequested: false,
    });
  });

  it("keeps WORKFLOW durable when collector launch is uncertain so Start can be retried", async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error("runtime unavailable")).mockResolvedValueOnce(undefined);
    const { service, controls } = await setup({ start });
    const command = { scope: owner, automationId: "auto-1", captureSessionId: "capture-1" };

    await expect(service.startWorkflow(command)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(controls.getState(owner, "capture-1")).resolves.toEqual({
      phase: "WORKFLOW",
      finishRequested: false,
    });
    await expect(service.startWorkflow(command)).resolves.toMatchObject({ phase: "WORKFLOW" });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("durably cancels the active capture before stopping its ephemeral browser", async () => {
    const events: string[] = [];
    let activeRecord: CaptureSessionRecord | null = structuredClone(record);
    const sessions: ActiveCaptureSessionStore = {
      async activeForAutomation() { return activeRecord?.status === "STARTED" ? structuredClone(activeRecord) : null; },
      async cancel(_scope, _captureSessionId, canceledAt) {
        events.push("cancel-durable");
        activeRecord = { ...record, status: "CANCELED", canceledAt };
        return "CANCELED";
      },
    };
    const durableSessions = new InMemoryCaptureSessionStore();
    const controls = new InMemoryCaptureCollectionControlStore();
    await durableSessions.putStarted(record);
    await controls.putInitial(initialCaptureCollectionControlRecord({ scope: owner, automationId: "auto-1", captureSessionId: "capture-1", updatedAt: record.startedAt }));
    const service = new CaptureRecordingControlPlaneService(
      sessions,
      new CaptureCollectionControlService(durableSessions, controls),
      undefined,
      { async stop() { events.push("stop-browser"); } },
      () => new Date("2026-08-21T00:20:00.000Z"),
    );

    await expect(service.cancel(owner, "auto-1")).resolves.toEqual({ kind: "CANCELED", cleanupPending: false });
    expect(events).toEqual(["cancel-durable", "stop-browser"]);
    await expect(service.state(owner, "auto-1")).resolves.toEqual({ kind: "NONE" });
  });

  it("keeps cancellation authoritative when browser cleanup fails", async () => {
    const { service, stop } = await setup();
    stop.mockRejectedValueOnce(new Error("stop uncertain"));

    await expect(service.cancel(owner, "auto-1")).resolves.toEqual({ kind: "CANCELED", cleanupPending: true });
    await expect(service.state(owner, "auto-1")).resolves.toEqual({ kind: "NONE" });
  });

  it("rejects cross-tenant and stale-session commands before changing control state", async () => {
    const { service, controls } = await setup();

    await expect(service.startWorkflow({ scope: attacker, automationId: "auto-1", captureSessionId: "capture-1" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.startWorkflow({ scope: owner, automationId: "auto-1", captureSessionId: "capture-old" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(controls.getState(owner, "capture-1")).resolves.toEqual({
      phase: "AUTH_SETUP",
      finishRequested: false,
    });
  });
});

describe("CaptureAwareControlPlaneHttpHandler", () => {
  it("uses trusted authenticated scope for recording commands and delegates unrelated routes", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = {
      async handle() { return { status: 204, body: null }; },
    };
    const handler = new CaptureAwareControlPlaneHttpHandler(base, service);

    const started = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/capture-recording/start",
      body: {
        tenantId: attacker.tenantId,
        userId: attacker.userId,
        captureSessionId: "capture-1",
      },
    }, { scope: owner });
    const delegated = await handler.handle({ method: "GET", path: "/v1/automations/auto-1" }, { scope: owner });

    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ kind: "ACTIVE", phase: "WORKFLOW" });
    expect(delegated).toEqual({ status: 204, body: null });
  });

  it("cancels the server-resolved active capture without accepting a browser-supplied session id", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = { async handle() { return { status: 404, body: null }; } };
    const handler = new CaptureAwareControlPlaneHttpHandler(base, service);

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/capture-recording/cancel",
      body: { captureSessionId: "forged-capture" },
    }, { scope: owner });

    expect(response).toEqual({ status: 200, body: { kind: "CANCELED", cleanupPending: false } });
    await expect(service.state(owner, "auto-1")).resolves.toEqual({ kind: "NONE" });
  });

  it("returns sanitized conflicts instead of provider or browser state", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = { async handle() { return { status: 404, body: null }; } };
    const handler = new CaptureAwareControlPlaneHttpHandler(base, service);

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/capture-recording/finish",
      body: { captureSessionId: "capture-1" },
    }, { scope: owner });

    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain("browser-session-secret");
    expect(JSON.stringify(response.body)).not.toContain("browser-profile-secret");
  });
});
