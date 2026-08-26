import { describe, expect, it, vi } from "vitest";
import {
  CaptureCollectionControlService,
  InMemoryCaptureCollectionControlStore,
  initialCaptureCollectionControlRecord,
} from "./capture-control.js";
import { InMemoryCaptureSessionStore, type CaptureSessionRecord } from "./capture-completion.js";
import {
  CaptureRecordingControlPlaneService,
  type ActiveCaptureSessionStore,
} from "./capture-recording.js";

const scope = { tenantId: "tenant-a", userId: "user-a" };
const session: CaptureSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "automation-a",
  captureSessionId: "capture-a",
  browserSessionId: "browser-a",
  browserProfileRef: "profile-a",
  startedAt: "2026-08-21T00:00:00.000Z",
  expiresAt: "2026-08-21T01:00:00.000Z",
  status: "STARTED",
};

describe("CaptureRecordingControlPlaneService collector readiness", () => {
  it("does not acknowledge recording until the production collector is durably ready", async () => {
    const durableSessions = new InMemoryCaptureSessionStore();
    await durableSessions.putStarted(session);
    const controls = new InMemoryCaptureCollectionControlStore();
    await controls.putInitial({
      ...initialCaptureCollectionControlRecord({
        scope,
        automationId: session.automationId,
        captureSessionId: session.captureSessionId,
        updatedAt: session.startedAt,
      }),
      collectorReady: false,
    });
    const activeSessions: ActiveCaptureSessionStore = {
      async activeForAutomation() { return structuredClone(session); },
      async cancel() { return "CANCELED"; },
    };
    const controlService = new CaptureCollectionControlService(
      durableSessions,
      controls,
      () => new Date("2026-08-21T00:10:00.000Z"),
    );
    const start = vi.fn(async () => {
      setTimeout(() => {
        void controls.markReady(scope, session.captureSessionId, "2026-08-21T00:10:01.000Z");
      }, 20);
    });
    const service = new CaptureRecordingControlPlaneService(
      activeSessions,
      controlService,
      { start },
      undefined,
      () => new Date("2026-08-21T00:10:00.000Z"),
    );

    let settled = false;
    const result = service.startWorkflow({ scope, automationId: session.automationId })
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    await expect(result).resolves.toMatchObject({
      kind: "ACTIVE",
      phase: "WORKFLOW",
      finishRequested: false,
    });
    expect(start).toHaveBeenCalledOnce();
    await expect(controls.getState(scope, session.captureSessionId)).resolves.toMatchObject({
      phase: "WORKFLOW",
      collectorReady: true,
    });
  });

  it("keeps an unready production collector on the safe pre-recording presentation", async () => {
    const durableSessions = new InMemoryCaptureSessionStore();
    await durableSessions.putStarted(session);
    const controls = new InMemoryCaptureCollectionControlStore();
    await controls.putInitial({
      ...initialCaptureCollectionControlRecord({
        scope,
        automationId: session.automationId,
        captureSessionId: session.captureSessionId,
        updatedAt: session.startedAt,
      }),
      collectorReady: false,
    });
    await controls.startWorkflow(scope, session.captureSessionId, "2026-08-21T00:00:01.000Z");
    const activeSessions: ActiveCaptureSessionStore = {
      async activeForAutomation() { return structuredClone(session); },
      async cancel() { return "CANCELED"; },
    };
    const service = new CaptureRecordingControlPlaneService(
      activeSessions,
      new CaptureCollectionControlService(durableSessions, controls),
      { start: async () => undefined },
    );

    await expect(service.state(scope, session.automationId)).resolves.toMatchObject({
      kind: "ACTIVE",
      phase: "AUTH_SETUP",
      finishRequested: false,
    });
  });
});
