import { describe, expect, it } from "vitest";
import type { AutomationRecord, RunCheckpoint, RunRecord } from "@automation/contracts";
import {
  HumanResumeControlPlaneService,
  HumanTakeoverService,
  InMemoryAutomationRepository,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  type HumanResumeExecutionPort,
  type HumanResumeSubmission,
  type HumanTakeoverBrowserPort,
  type HumanTakeoverSessionRecord,
  type HumanTakeoverSessionStore,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Auth repair",
  websiteUrl: "https://example.com",
  prompt: "submit form",
  status: "ACTIVE",
  publishedWorkflowVersion: 1,
  browserProfileRef: "profile://tenant-1/auto-1",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};
const run: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: automation.automationId,
  workflowVersion: 1,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-21T00:00:00.000Z",
  startedAt: "2026-08-21T00:00:01.000Z",
  currentNodeId: "submit",
};
const checkpoint: RunCheckpoint = {
  runId: run.runId,
  automationId: automation.automationId,
  workflowVersion: 1,
  currentNodeId: "submit",
  completedNodeIds: ["navigate"],
  attempt: 1,
  fingerprintRepeatCount: 1,
  variables: {},
  evidenceRefs: [],
  lastFailure: {
    code: "TARGET_AUTH_REQUIRED",
    message: "login required",
    retryable: false,
    nodeId: "submit",
    evidenceRefs: [],
  },
  updatedAt: "2026-08-21T00:00:02.000Z",
};

class MemoryTakeovers implements HumanTakeoverSessionStore {
  record: HumanTakeoverSessionRecord | null = null;
  async putStarted(record: HumanTakeoverSessionRecord, _now: string): Promise<"CREATED" | "CONFLICT"> {
    if (this.record?.status === "ACTIVE") return "CONFLICT";
    this.record = structuredClone(record);
    return "CREATED";
  }
  async getForRun(requestScope: OwnershipScope, runId: string): Promise<HumanTakeoverSessionRecord | null> {
    if (!this.record || this.record.runId !== runId || this.record.tenantId !== requestScope.tenantId || this.record.userId !== requestScope.userId) return null;
    return structuredClone(this.record);
  }
  async complete(_scope: OwnershipScope, runId: string, takeoverId: string, completedAt: string): Promise<"COMPLETED" | "REPLAY"> {
    if (!this.record || this.record.runId !== runId || this.record.takeoverId !== takeoverId) throw new Error("conflict");
    if (this.record.status === "COMPLETED") return "REPLAY";
    this.record = { ...this.record, status: "COMPLETED", completedAt };
    return "COMPLETED";
  }
}

class RecordingBrowser implements HumanTakeoverBrowserPort {
  starts = 0;
  saves = 0;
  stops = 0;
  async start(): Promise<{ browserSessionId: string; liveViewUrl: string; expiresAt: string }> {
    this.starts += 1;
    return {
      browserSessionId: "browser-1",
      liveViewUrl: "https://live.example.test/repair",
      expiresAt: "2026-08-21T00:15:00.000Z",
    };
  }
  async liveView(_scope: OwnershipScope, record: HumanTakeoverSessionRecord) {
    return { browserSessionId: record.browserSessionId, liveViewUrl: "https://live.example.test/repair-again", expiresAt: record.expiresAt };
  }
  async saveProfile(): Promise<void> { this.saves += 1; }
  async stop(): Promise<void> { this.stops += 1; }
}

class RecordingResume implements HumanResumeExecutionPort {
  calls: HumanResumeSubmission[] = [];
  async execute(request: HumanResumeSubmission) {
    this.calls.push(structuredClone(request));
    return { kind: "RESUMED" as const, runId: request.runId, status: "SUCCEEDED" as const };
  }
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const sessions = new MemoryTakeovers();
  const browser = new RecordingBrowser();
  const execution = new RecordingResume();
  await automations.put(automation);
  await runs.createIfAbsent(run);
  await checkpoints.put(scope, checkpoint);
  const resume = new HumanResumeControlPlaneService(runs, checkpoints, execution);
  const service = new HumanTakeoverService(
    automations,
    runs,
    checkpoints,
    sessions,
    browser,
    resume,
    {
      now: () => new Date("2026-08-21T00:05:00.000Z"),
      takeoverId: () => "takeover-1",
    },
  );
  return { service, sessions, browser, execution, runs, checkpoints };
}

describe("HumanTakeoverService", () => {
  it("opens one bounded repair browser for a durable TARGET_AUTH_REQUIRED pause", async () => {
    const { service, sessions, browser } = await setup();
    await expect(service.start(scope, "auto-1", "run-1")).resolves.toEqual({
      kind: "READY",
      liveViewUrl: "https://live.example.test/repair",
      expiresAt: "2026-08-21T00:15:00.000Z",
    });
    expect(browser.starts).toBe(1);
    expect(sessions.record).toMatchObject({
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: "auto-1",
      runId: "run-1",
      nodeId: "submit",
      browserSessionId: "browser-1",
      browserProfileRef: "profile://tenant-1/auto-1",
      status: "ACTIVE",
    });
  });

  it("reuses an active server-owned repair session instead of allocating another browser", async () => {
    const { service, browser } = await setup();
    await service.start(scope, "auto-1", "run-1");
    await expect(service.start(scope, "auto-1", "run-1")).resolves.toMatchObject({
      liveViewUrl: "https://live.example.test/repair-again",
    });
    expect(browser.starts).toBe(1);
  });

  it("saves the repaired profile before invoking the existing idempotent resume authority", async () => {
    const { service, browser, execution, sessions } = await setup();
    await service.start(scope, "auto-1", "run-1");
    await expect(service.finish(scope, "auto-1", "run-1")).resolves.toMatchObject({ kind: "RESUMED" });
    expect(browser.saves).toBe(1);
    expect(sessions.record?.status).toBe("COMPLETED");
    expect(execution.calls).toHaveLength(1);
    expect(execution.calls[0]).toMatchObject({
      scope,
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "submit",
      resolutionId: "authenticated-user-confirm-v1",
    });
  });

  it("rejects non-auth attention before allocating browser compute", async () => {
    const { service, browser, checkpoints } = await setup();
    await checkpoints.put(scope, {
      ...checkpoint,
      lastFailure: { ...checkpoint.lastFailure!, code: "POLICY_BLOCKED" },
    });
    await expect(service.start(scope, "auto-1", "run-1")).rejects.toThrow("does not require target-site authentication repair");
    expect(browser.starts).toBe(0);
  });

  it("rejects target-auth failure metadata for another node before browser allocation", async () => {
    const { service, browser, checkpoints } = await setup();
    await checkpoints.put(scope, {
      ...checkpoint,
      lastFailure: { ...checkpoint.lastFailure!, nodeId: "other-node" },
    });
    await expect(service.start(scope, "auto-1", "run-1")).rejects.toThrow("does not require target-site authentication repair");
    expect(browser.starts).toBe(0);
  });

  it("rejects cross-tenant takeover before browser allocation", async () => {
    const { service, browser } = await setup();
    await expect(service.start({ tenantId: "other", userId: "user-1" }, "auto-1", "run-1")).rejects.toThrow("run not found");
    expect(browser.starts).toBe(0);
  });
});
