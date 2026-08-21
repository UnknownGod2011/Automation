import type { AutomationRecord, FailureCode, RunCheckpoint, RunRecord } from "@automation/contracts";
import { describe, expect, it } from "vitest";
import {
  ScheduledRunOutcomeReporter,
  type NotificationMessage,
  type ScheduledRunWorkerResult,
} from "./index.js";

const scope = { tenantId: "tenant-1", userId: "user-1" } as const;
const scheduledAt = "2026-08-20T06:00:00.000Z";

function automation(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    name: "Daily workflow",
    websiteUrl: "https://example.com",
    prompt: "Do the task",
    status: "ACTIVE",
    publishedWorkflowVersion: 2,
    browserProfileRef: "profile-1",
    notifyOnSuccess: true,
    notifyOnFailure: true,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function run(status: RunRecord["status"], overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 2,
    occurrenceKey: `auto-1:${scheduledAt}`,
    status,
    scheduledAt,
    ...overrides,
  };
}

function checkpoint(code: FailureCode): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 2,
    currentNodeId: "node-1",
    completedNodeIds: [],
    attempt: 0,
    fingerprintRepeatCount: 0,
    variables: {},
    evidenceRefs: ["artifact-private"],
    lastFailure: {
      code,
      message: "secret-bearing raw provider/browser error",
      retryable: false,
      evidenceRefs: ["artifact-private"],
    },
    updatedAt: scheduledAt,
  };
}

function resultFor(runRecord: RunRecord, cp: RunCheckpoint | null = null): ScheduledRunWorkerResult {
  return {
    kind: "EXECUTED",
    preparation: {
      kind: "READY",
      automation: automation(),
      graph: {
        schemaVersion: 1,
        workflowId: "workflow-1",
        automationId: "auto-1",
        version: 2,
        entryNodeId: "end",
        objective: "done",
        nodes: {
          end: {
            id: "end",
            kind: "END",
            objective: "done",
            deterministicStrategies: [],
            inputBindings: {},
            outputBindings: {},
            allowedSideEffects: [],
            retryPolicy: {
              maxAttempts: 1,
              initialBackoffMs: 0,
              maxBackoffMs: 0,
              jitter: false,
              retryableFailureCodes: [],
            },
            timeoutMs: 1000,
            escalation: "FAIL",
          },
        },
        createdAt: scheduledAt,
      },
      run: run("RUNNING"),
      lease: { automationId: "auto-1", ownerToken: "owner-private", expiresAt: scheduledAt },
    },
    execution: { run: runRecord, checkpoint: cp },
    cleanupWarnings: [],
  };
}

describe("ScheduledRunOutcomeReporter", () => {
  it("emits bounded success telemetry and respects success notification preference", async () => {
    const events: unknown[] = [];
    const messages: NotificationMessage[] = [];
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit(event) { events.push(event); } },
      notifications: { async send(_scope, message) { messages.push(message); } },
      now: () => new Date("2026-08-20T06:00:05.000Z"),
    });

    await reporter.report({
      scope,
      automation: automation({ notifyOnSuccess: true }),
      result: resultFor(run("SUCCEEDED", {
        startedAt: "2026-08-20T06:00:01.000Z",
        finishedAt: "2026-08-20T06:00:04.000Z",
      })),
    });

    expect(events).toEqual([expect.objectContaining({
      eventName: "scheduled_run_outcome",
      outcome: "SUCCEEDED",
      runId: "run-1",
      durationMs: 3000,
    })]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("RUN_SUCCEEDED");
  });

  it("always surfaces human attention but never includes raw failure detail or evidence", async () => {
    const events: unknown[] = [];
    const messages: NotificationMessage[] = [];
    const cp = checkpoint("TARGET_AUTH_REQUIRED");
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit(event) { events.push(event); } },
      notifications: { async send(_scope, message) { messages.push(message); } },
    });

    await reporter.report({
      scope,
      automation: automation({ notifyOnFailure: false }),
      result: resultFor(run("WAITING_FOR_HUMAN", { currentNodeId: "node-1" }), cp),
    });

    expect(events).toEqual([expect.objectContaining({
      outcome: "NEEDS_ATTENTION",
      failureCode: "TARGET_AUTH_REQUIRED",
      nodeId: "node-1",
    })]);
    expect(JSON.stringify(events)).not.toContain("secret-bearing");
    expect(JSON.stringify(events)).not.toContain("artifact-private");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("AUTH_REQUIRED");
    expect(messages[0]?.body).not.toContain("secret-bearing");
    expect(messages[0]?.body).not.toContain("artifact-private");
  });

  it("reports a newly executed human resume through the same sanitized success boundary", async () => {
    const events: unknown[] = [];
    const messages: NotificationMessage[] = [];
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit(event) { events.push(event); } },
      notifications: { async send(_scope, message) { messages.push(message); } },
    });

    const report = await reporter.reportHumanResume({
      scope,
      automation: automation({ notifyOnSuccess: true }),
      execution: {
        run: run("SUCCEEDED", {
          startedAt: "2026-08-20T06:00:01.000Z",
          finishedAt: "2026-08-20T06:00:04.000Z",
        }),
        checkpoint: null,
      },
    });

    expect(report).toMatchObject({ telemetryDelivered: true, notificationDelivered: true });
    expect(events).toEqual([expect.objectContaining({
      eventName: "human_resume_outcome",
      outcome: "SUCCEEDED",
      runId: "run-1",
    })]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("RUN_SUCCEEDED");
  });

  it("does not report an in-progress human resume as a terminal product outcome", async () => {
    let calls = 0;
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit() { calls += 1; } },
      notifications: { async send() { calls += 1; } },
    });

    await expect(reporter.reportHumanResume({
      scope,
      automation: automation(),
      execution: { run: run("RUNNING"), checkpoint: null },
    })).resolves.toEqual({
      telemetryDelivered: false,
      notificationDelivered: false,
      warnings: [],
    });
    expect(calls).toBe(0);
  });

  it("suppresses duplicate-delivery email and treats reporting outages as non-authoritative warnings", async () => {
    const warnings: string[] = [];
    let sends = 0;
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit() { throw new Error("cloudwatch secret detail"); } },
      notifications: { async send() { sends += 1; throw new Error("ses secret detail"); } },
      warn(message) { warnings.push(message); },
    });
    const duplicateResult: ScheduledRunWorkerResult = {
      kind: "NOT_RUN",
      preparation: { kind: "DUPLICATE", run: run("SUCCEEDED") },
      cleanupWarnings: [],
    };

    const report = await reporter.report({
      scope,
      automation: automation(),
      result: duplicateResult,
    });

    expect(report.telemetryDelivered).toBe(false);
    expect(report.notificationDelivered).toBe(false);
    expect(sends).toBe(0);
    expect(warnings).toEqual(["scheduled run telemetry delivery failed"]);
    expect(JSON.stringify(report)).not.toContain("secret detail");
  });

  it("rejects cross-tenant reporting context before telemetry or notification", async () => {
    let calls = 0;
    const reporter = new ScheduledRunOutcomeReporter({
      telemetry: { async emit() { calls += 1; } },
      notifications: { async send() { calls += 1; } },
    });

    await expect(reporter.report({
      scope: { tenantId: "tenant-2", userId: scope.userId },
      automation: automation(),
      result: resultFor(run("SUCCEEDED")),
    })).rejects.toThrow("ownership does not match context");
    expect(calls).toBe(0);
  });
});
