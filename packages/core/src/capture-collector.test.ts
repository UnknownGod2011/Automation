import { describe, expect, it } from "vitest";
import type { AutomationRecord, CaptureEvent } from "@automation/contracts";
import { CaptureCollectionService, type CaptureCollectionEventSource } from "./capture-collector.js";
import type { CaptureSessionRecord } from "./capture-completion.js";

const scope = { tenantId: "tenant-a", userId: "user-a" };
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "automation-a",
  name: "Capture test",
  websiteUrl: "https://example.com/",
  prompt: "Save a note",
  status: "CAPTURING",
  browserProfileRef: "profile-a",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};
const session: CaptureSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: automation.automationId,
  captureSessionId: "capture-a",
  browserSessionId: "browser-a",
  browserProfileRef: "profile-a",
  startedAt: "2026-08-21T00:00:00.000Z",
  expiresAt: "2026-08-21T01:00:00.000Z",
  status: "STARTED",
};
const events: readonly CaptureEvent[] = [
  {
    eventId: "event-1",
    sequence: 1,
    kind: "NAVIGATION",
    purpose: "WORKFLOW",
    occurredAt: "2026-08-21T00:01:00.000Z",
    page: { url: "https://example.com/app" },
    navigationUrl: "https://example.com/app",
    artifactRefs: [],
  },
];
const control = {
  getState: async () => ({ phase: "WORKFLOW" as const, finishRequested: true }),
};

describe("CaptureCollectionService", () => {
  it("builds and validates a tenant-scoped trace from the durable capture session", async () => {
    const source: CaptureCollectionEventSource = { collect: async () => events };
    const service = new CaptureCollectionService(source, {
      now: () => new Date("2026-08-21T00:02:00.000Z"),
      traceIds: { create: () => "trace-a" },
    });

    await expect(service.collect({ scope, automation, session, control })).resolves.toMatchObject({
      traceId: "trace-a",
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: automation.automationId,
      browserProfileRef: session.browserProfileRef,
      finishedAt: "2026-08-21T00:02:00.000Z",
      events,
    });
  });

  it("rejects cross-tenant collection before the event source runs", async () => {
    let calls = 0;
    const service = new CaptureCollectionService({ collect: async () => { calls += 1; return events; } });

    await expect(service.collect({
      scope: { tenantId: "tenant-b", userId: scope.userId },
      automation,
      session,
      control,
    })).rejects.toThrow("automation ownership");
    expect(calls).toBe(0);
  });

  it("rejects completed sessions before collection", async () => {
    const service = new CaptureCollectionService({ collect: async () => events });
    await expect(service.collect({
      scope,
      automation,
      session: { ...session, status: "COMPLETED", traceId: "trace-old", completedAt: "2026-08-21T00:01:00.000Z" },
      control,
    })).rejects.toThrow("STARTED");
  });

  it("rejects a collection that finishes after the durable session expires", async () => {
    const service = new CaptureCollectionService(
      { collect: async () => events },
      { now: () => new Date(session.expiresAt) },
    );
    await expect(service.collect({ scope, automation, session, control })).rejects.toThrow("expired");
  });
});
