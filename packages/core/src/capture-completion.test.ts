import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import {
  CaptureCompletionService,
  InMemoryCaptureSessionStore,
  type CaptureSessionFinalizer,
  type CaptureSessionRecord,
  type CaptureTracePersister,
} from "./capture-completion.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const session: CaptureSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  captureSessionId: "capture-1",
  browserSessionId: "browser-1",
  browserProfileRef: "profile-1",
  startedAt: "2026-08-20T00:00:00.000Z",
  expiresAt: "2026-08-20T01:00:00.000Z",
  status: "STARTED",
};
const trace: CaptureTrace = {
  schemaVersion: 1,
  traceId: "trace-1",
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  websiteUrl: "https://example.com/",
  objective: "Save the form",
  browserProfileRef: "profile-1",
  startedAt: "2026-08-20T00:00:00.000Z",
  finishedAt: "2026-08-20T00:05:00.000Z",
  events: [
    {
      eventId: "e1",
      sequence: 1,
      kind: "NAVIGATION",
      purpose: "WORKFLOW",
      occurredAt: "2026-08-20T00:01:00.000Z",
      page: { url: "https://example.com/" },
      navigationUrl: "https://example.com/",
      artifactRefs: [],
    },
  ],
};

class FakeFinalizer implements CaptureSessionFinalizer {
  readonly events: string[] = [];
  stopError = false;
  async saveProfile() { this.events.push("save-profile"); }
  async stop() {
    this.events.push("stop");
    if (this.stopError) throw new Error("stop failed");
  }
}

class FakePersister implements CaptureTracePersister {
  constructor(private readonly events: string[]) {}
  async persistCapture(request: { scope: typeof scope; trace: CaptureTrace }) {
    this.events.push("persist-trace");
    return structuredClone(request.trace);
  }
}

describe("CaptureCompletionService", () => {
  it("saves the browser profile before accepting the trace and records completion", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const persister = new FakePersister(finalizer.events);
    const service = new CaptureCompletionService(
      sessions,
      finalizer,
      persister,
      () => new Date("2026-08-20T00:10:00.000Z"),
    );

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toEqual({ traceId: "trace-1", replayed: false, cleanupPending: false });
    expect(finalizer.events).toEqual(["save-profile", "persist-trace", "stop"]);
    expect(await sessions.latestCompletedForAutomation(scope, "auto-1")).toMatchObject({
      status: "COMPLETED",
      traceId: "trace-1",
    });
  });

  it("returns an exact completed replay without repeating browser or trace side effects", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    await sessions.complete(scope, "capture-1", "trace-1", "2026-08-20T00:09:00.000Z");
    const finalizer = new FakeFinalizer();
    const service = new CaptureCompletionService(
      sessions,
      finalizer,
      new FakePersister(finalizer.events),
      () => new Date("2026-08-20T00:10:00.000Z"),
    );

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toEqual({ traceId: "trace-1", replayed: true, cleanupPending: false });
    expect(finalizer.events).toEqual([]);
  });

  it("rejects cross-automation and expired completion before browser-profile persistence", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const service = new CaptureCompletionService(
      sessions,
      finalizer,
      new FakePersister(finalizer.events),
      () => new Date("2026-08-20T01:00:00.000Z"),
    );

    await expect(service.complete({ scope, automationId: "auto-other", captureSessionId: "capture-1", trace }))
      .rejects.toThrow(/another automation/);
    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .rejects.toThrow(/expired/);
    expect(finalizer.events).toEqual([]);
  });

  it("reports cleanup as pending without revoking an already durable capture", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    finalizer.stopError = true;
    const service = new CaptureCompletionService(
      sessions,
      finalizer,
      new FakePersister(finalizer.events),
      () => new Date("2026-08-20T00:10:00.000Z"),
    );

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toMatchObject({ traceId: "trace-1", cleanupPending: true });
  });
});
