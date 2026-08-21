import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, CaptureTrace } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { CaptureCollectionWorker } from "./capture-worker.js";
import type { OwnershipScope } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Demo",
  websiteUrl: "https://example.test/app",
  prompt: "Save a note",
  consentAcknowledged: true,
  browserProfileRef: "profile-1",
  status: "DRAFT",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

const trace: CaptureTrace = {
  schemaVersion: 1,
  traceId: "trace-capture-1",
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: automation.automationId,
  websiteUrl: automation.websiteUrl,
  objective: automation.prompt,
  browserProfileRef: "profile-1",
  startedAt: "2026-08-21T00:00:00.000Z",
  finishedAt: "2026-08-21T00:10:00.000Z",
  events: [],
};

async function sessionStore() {
  const sessions = new InMemoryCaptureSessionStore();
  await sessions.putStarted({
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: automation.automationId,
    captureSessionId: "capture-1",
    browserSessionId: "browser-secret",
    browserProfileRef: "profile-1",
    startedAt: trace.startedAt,
    expiresAt: "2026-08-21T01:00:00.000Z",
    status: "STARTED",
  });
  return sessions;
}

describe("CaptureCollectionWorker", () => {
  it("collects from the durable session and delegates authoritative completion", async () => {
    const sessions = await sessionStore();
    const collect = vi.fn(async () => trace);
    const complete = vi.fn(async () => ({ traceId: trace.traceId, replayed: false, cleanupPending: false }));
    const worker = new CaptureCollectionWorker({
      automations: { async get() { return automation; } },
      sessions,
      controls: { async getState() { return { phase: "WORKFLOW" as const, finishRequested: true }; } },
      collector: { collect },
      completion: { complete },
    });

    await expect(worker.execute({ scope, automationId: "auto-1", captureSessionId: "capture-1" }))
      .resolves.toEqual({ traceId: trace.traceId, replayed: false, cleanupPending: false });
    expect(collect).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith({
      scope,
      automationId: "auto-1",
      captureSessionId: "capture-1",
      trace,
    });
  });

  it("treats an already-completed same session as replay without reconnecting a browser", async () => {
    const sessions = await sessionStore();
    await sessions.complete(scope, "capture-1", trace.traceId, trace.finishedAt);
    const collect = vi.fn(async () => trace);
    const complete = vi.fn();
    const worker = new CaptureCollectionWorker({
      automations: { async get() { return automation; } },
      sessions,
      controls: { async getState() { return { phase: "WORKFLOW" as const, finishRequested: true }; } },
      collector: { collect },
      completion: { complete },
    });

    await expect(worker.execute({ scope, automationId: "auto-1", captureSessionId: "capture-1" }))
      .resolves.toEqual({ traceId: trace.traceId, replayed: true, cleanupPending: false });
    expect(collect).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects a session belonging to another automation before collection", async () => {
    const sessions = await sessionStore();
    const collect = vi.fn(async () => trace);
    const worker = new CaptureCollectionWorker({
      automations: { async get() { return { ...automation, automationId: "auto-2" }; } },
      sessions,
      controls: { async getState() { return { phase: "WORKFLOW" as const, finishRequested: false }; } },
      collector: { collect },
      completion: { async complete() { throw new Error("should not complete"); } },
    });

    await expect(worker.execute({ scope, automationId: "auto-2", captureSessionId: "capture-1" }))
      .rejects.toThrow("capture session identity mismatch");
    expect(collect).not.toHaveBeenCalled();
  });
});
