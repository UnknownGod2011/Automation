import { describe, expect, it } from "vitest";
import type { CaptureSessionRecord } from "./capture-completion.js";
import type { CaptureCollectionControlService } from "./capture-control.js";
import {
  CaptureRecordingControlPlaneService,
  type ActiveCaptureSessionStore,
} from "./capture-recording.js";
import type { OwnershipScope } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const expired: CaptureSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  captureSessionId: "capture-expired",
  browserSessionId: "browser-session-secret",
  browserProfileRef: "browser-profile-secret",
  startedAt: "2026-08-23T10:00:00.000Z",
  expiresAt: "2026-08-23T11:00:00.000Z",
  status: "STARTED",
};

function harness(record: CaptureSessionRecord = expired) {
  let cancelCalls = 0;
  let controlReads = 0;
  let taskStarts = 0;
  let cleanupCalls = 0;
  const sessions: ActiveCaptureSessionStore = {
    async activeForAutomation(requestScope, automationId) {
      if (
        requestScope.tenantId !== scope.tenantId ||
        requestScope.userId !== scope.userId ||
        automationId !== record.automationId
      ) return null;
      return structuredClone(record);
    },
    async cancel() {
      cancelCalls += 1;
      return "CANCELED";
    },
  };
  const controls = {
    async getState() {
      controlReads += 1;
      return { phase: "WORKFLOW", finishRequested: true } as const;
    },
    async startWorkflow() { return "REPLAY" as const; },
    async finish() { return "REPLAY" as const; },
  } satisfies Pick<CaptureCollectionControlService, "getState" | "startWorkflow" | "finish">;
  const service = new CaptureRecordingControlPlaneService(
    sessions,
    controls,
    { async start() { taskStarts += 1; } },
    { async stop() { cleanupCalls += 1; } },
    () => new Date("2026-08-23T11:00:00.000Z"),
  );
  return {
    service,
    counters: () => ({ cancelCalls, controlReads, taskStarts, cleanupCalls }),
  };
}

describe("expired capture recording state", () => {
  it("stops presenting an expired durable capture as active", async () => {
    const { service, counters } = harness();

    await expect(service.state(scope, "auto-1")).resolves.toEqual({ kind: "NONE" });
    expect(counters()).toEqual({ cancelCalls: 0, controlReads: 0, taskStarts: 0, cleanupCalls: 0 });
  });

  it("rejects stale Start/Finish commands before collector or control work", async () => {
    const { service, counters } = harness();
    const command = {
      scope,
      automationId: "auto-1",
      captureSessionId: "capture-expired",
    };

    await expect(service.startWorkflow(command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.finish(command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(counters()).toEqual({ cancelCalls: 0, controlReads: 0, taskStarts: 0, cleanupCalls: 0 });
  });

  it("does not mutate or clean up an already-expired capture from the product command path", async () => {
    const { service, counters } = harness();

    await expect(service.cancel(scope, "auto-1")).resolves.toEqual({ kind: "NONE" });
    expect(counters()).toEqual({ cancelCalls: 0, controlReads: 0, taskStarts: 0, cleanupCalls: 0 });
  });

  it("fails closed when the durable expiry itself is malformed", async () => {
    const { service } = harness({ ...expired, expiresAt: "not-a-timestamp" });

    await expect(service.state(scope, "auto-1")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "active capture expiry is invalid",
    });
  });
});