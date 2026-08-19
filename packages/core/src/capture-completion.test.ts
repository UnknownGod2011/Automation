import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import {
  CaptureCompletionService,
  InMemoryCaptureSessionStore,
  type CaptureSessionFinalizer,
  type CaptureSessionRecord,
  type CaptureTracePersister,
  type CaptureTraceReader,
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

class FakeTraceStore implements CaptureTracePersister, CaptureTraceReader {
  readonly records = new Map<string, CaptureTrace>();
  failAfterPersist = false;
  readonly events: string[];

  constructor(events: string[]) {
    this.events = events;
  }

  async persistCapture(request: { scope: typeof scope; trace: CaptureTrace }) {
    this.events.push("persist-trace");
    if (this.records.has(request.trace.traceId)) throw new Error("immutable trace already exists");
    this.records.set(request.trace.traceId, structuredClone(request.trace));
    if (this.failAfterPersist) throw new Error("worker lost acknowledgement after trace persistence");
    return structuredClone(request.trace);
  }

  async get(
    requestScope: typeof scope,
    automationId: string,
    traceId: string,
  ): Promise<CaptureTrace | null> {
    if (requestScope.tenantId !== scope.tenantId || requestScope.userId !== scope.userId) return null;
    const stored = this.records.get(traceId);
    if (!stored || stored.automationId !== automationId) return null;
    return structuredClone(stored);
  }
}

function makeService(
  sessions: InMemoryCaptureSessionStore,
  finalizer: FakeFinalizer,
  traces: FakeTraceStore,
  now = () => new Date("2026-08-20T00:10:00.000Z"),
) {
  return new CaptureCompletionService(sessions, finalizer, traces, traces, now);
}

describe("CaptureCompletionService", () => {
  it("saves the browser profile before accepting the trace and records completion", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const traces = new FakeTraceStore(finalizer.events);
    const service = makeService(sessions, finalizer, traces);

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
    const traces = new FakeTraceStore(finalizer.events);
    const service = makeService(sessions, finalizer, traces);

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toEqual({ traceId: "trace-1", replayed: true, cleanupPending: false });
    expect(finalizer.events).toEqual([]);
  });

  it("reconciles exact same-trace persistence when the trace write acknowledgement is lost", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const traces = new FakeTraceStore(finalizer.events);
    traces.failAfterPersist = true;
    const service = makeService(sessions, finalizer, traces);

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toEqual({ traceId: "trace-1", replayed: false, cleanupPending: false });
    expect(await sessions.latestCompletedForAutomation(scope, "auto-1")).toMatchObject({
      status: "COMPLETED",
      traceId: "trace-1",
    });
    expect(finalizer.events).toEqual(["save-profile", "persist-trace", "stop"]);
  });

  it("rejects same trace ID with different immutable content", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const traces = new FakeTraceStore(finalizer.events);
    traces.records.set(trace.traceId, { ...structuredClone(trace), objective: "Different objective" });
    const service = makeService(sessions, finalizer, traces);

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .rejects.toThrow("already exists");
    expect((await sessions.get(scope, "capture-1"))?.status).toBe("STARTED");
  });

  it("rejects cross-automation and expired completion before browser-profile persistence", async () => {
    const sessions = new InMemoryCaptureSessionStore();
    await sessions.putStarted(session);
    const finalizer = new FakeFinalizer();
    const traces = new FakeTraceStore(finalizer.events);
    const service = makeService(
      sessions,
      finalizer,
      traces,
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
    const traces = new FakeTraceStore(finalizer.events);
    const service = makeService(sessions, finalizer, traces);

    await expect(service.complete({ scope, automationId: "auto-1", captureSessionId: "capture-1", trace }))
      .resolves.toMatchObject({ traceId: "trace-1", cleanupPending: true });
  });
});
