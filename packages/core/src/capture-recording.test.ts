import { describe, expect, it } from "vitest";
import {
  CaptureCollectionControlService,
  InMemoryCaptureCollectionControlStore,
  initialCaptureCollectionControlRecord,
} from "./capture-control.js";
import { InMemoryCaptureSessionStore, type CaptureSessionRecord } from "./capture-completion.js";
import {
  CaptureAwareControlPlaneHttpHandler,
  CaptureRecordingControlPlaneService,
  type ActiveCaptureSessionReader,
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

async function setup() {
  const sessions = new InMemoryCaptureSessionStore();
  const controls = new InMemoryCaptureCollectionControlStore();
  await sessions.putStarted(record);
  await controls.putInitial(initialCaptureCollectionControlRecord({
    scope: owner,
    automationId: record.automationId,
    captureSessionId: record.captureSessionId,
    updatedAt: record.startedAt,
  }));
  const active: ActiveCaptureSessionReader = {
    async activeForAutomation(scope, automationId) {
      if (scope.tenantId !== owner.tenantId || scope.userId !== owner.userId || automationId !== record.automationId) return null;
      return structuredClone(record);
    },
  };
  const control = new CaptureCollectionControlService(
    sessions,
    controls,
    () => new Date("2026-08-21T00:10:00.000Z"),
  );
  return { service: new CaptureRecordingControlPlaneService(active, control), controls };
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
