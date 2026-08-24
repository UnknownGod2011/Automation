import type { AutomationRecord, RunCheckpoint, RunRecord } from "@automation/contracts";
import { describe, expect, it } from "vitest";
import {
  AwsScheduledRunHandler,
  readAwsScheduledRunHandlerConfiguration,
  type AwsScheduledRunHandlerDependencies,
} from "./scheduled-run-handler.js";

const scope = { tenantId: "tenant-1", userId: "user-1" } as const;
const scheduledAt = "2026-08-20T06:00:00.000Z";

const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Daily workflow",
  websiteUrl: "https://example.com",
  prompt: "Do the task",
  status: "ACTIVE",
  publishedWorkflowVersion: 1,
  browserProfileRef: "profile-1",
  notifyOnSuccess: true,
  notifyOnFailure: true,
  createdAt: scheduledAt,
  updatedAt: scheduledAt,
};

function blockedRun(runId: string): RunRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId,
    automationId: "auto-1",
    workflowVersion: 1,
    occurrenceKey: `auto-1:${scheduledAt}`,
    status: "WAITING_FOR_HUMAN",
    scheduledAt,
    currentNodeId: "node-1",
  };
}

const blockedCheckpoint: RunCheckpoint = {
  runId: "run-placeholder",
  automationId: "auto-1",
  workflowVersion: 1,
  currentNodeId: "node-1",
  completedNodeIds: [],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: {},
  evidenceRefs: [],
  lastFailure: {
    code: "TARGET_AUTH_REQUIRED",
    message: "authentication required",
    retryable: false,
    evidenceRefs: [],
  },
  updatedAt: scheduledAt,
};

describe("AwsScheduledRunHandler reporting integration", () => {
  it("reports the authoritative blocked checkpoint after scheduled execution", async () => {
    let reported: Parameters<NonNullable<AwsScheduledRunHandlerDependencies["reporter"]>["report"]>[0] | undefined;
    const runner: NonNullable<AwsScheduledRunHandlerDependencies["runner"]> = async (_composition, request) => ({
      kind: "NOT_RUN",
      preparation: { kind: "BLOCKED", run: blockedRun(request.runId) },
      cleanupWarnings: [],
    });

    const dependencies: AwsScheduledRunHandlerDependencies = {
      coordinator: {
        automations: {
          async get(observedScope, automationId) {
            expect(observedScope).toEqual(scope);
            expect(automationId).toBe("auto-1");
            return automation;
          },
          async put() {},
          async list() { return [automation]; },
        },
        workflows: null as never,
        runs: null as never,
        checkpoints: null as never,
        profiles: null as never,
        locks: null as never,
      },
      worker: {
        sessions: null as never,
        runtimeFactory: null as never,
        runs: null as never,
        checkpoints: {
          async get(_scope, runId) { return { ...blockedCheckpoint, runId }; },
          async put() {},
        },
        browserSessionTimeoutSeconds: 60,
      },
      credentials: {
        metadata: null as never,
        vault: null as never,
        policy: { providerOrder: ["openai"] },
      },
      runner,
      reporter: {
        async report(context) {
          reported = context;
          return { telemetryDelivered: true, notificationDelivered: true, warnings: [] };
        },
      },
    };

    const configuration = readAwsScheduledRunHandlerConfiguration({ OPENAI_BYOK_MODEL: "gpt-5-mini" });
    if (configuration.kind !== "CONFIGURED") throw new Error("test configuration missing");
    const handler = new AwsScheduledRunHandler(configuration, dependencies);

    const result = await handler.handle({
      trustedScope: scope,
      headers: { WorkloadAccessToken: "trusted-workload-token" },
      payload: {
        schemaVersion: 1,
        scope,
        automationId: "auto-1",
        scheduleId: "schedule-1",
        scheduledAt,
        deliveryId: "delivery-1",
      },
    });

    expect(result.kind).toBe("NOT_RUN");
    expect(reported?.automation).toEqual(automation);
    expect(reported?.checkpoint?.lastFailure?.code).toBe("TARGET_AUTH_REQUIRED");
  });

  it("does not resolve reporting metadata before trusted-scope validation", async () => {
    let repositoryCalls = 0;
    const dependencies: AwsScheduledRunHandlerDependencies = {
      coordinator: {
        automations: {
          async get() { repositoryCalls += 1; return automation; },
          async put() {},
          async list() { return []; },
        },
        workflows: null as never,
        runs: null as never,
        checkpoints: null as never,
        profiles: null as never,
        locks: null as never,
      },
      worker: {
        sessions: null as never,
        runtimeFactory: null as never,
        runs: null as never,
        checkpoints: null as never,
        browserSessionTimeoutSeconds: 60,
      },
      credentials: {
        metadata: null as never,
        vault: null as never,
        policy: { providerOrder: ["openai"] },
      },
      runner: async () => { throw new Error("should not run"); },
      reporter: { async report() { throw new Error("should not report"); } },
    };
    const configuration = readAwsScheduledRunHandlerConfiguration({ OPENAI_BYOK_MODEL: "gpt-5-mini" });
    if (configuration.kind !== "CONFIGURED") throw new Error("test configuration missing");
    const handler = new AwsScheduledRunHandler(configuration, dependencies);

    await expect(handler.handle({
      trustedScope: scope,
      headers: { WorkloadAccessToken: "trusted-workload-token" },
      payload: {
        schemaVersion: 1,
        scope: { tenantId: "tenant-2", userId: "user-2" },
        automationId: "auto-1",
        scheduleId: "schedule-1",
        scheduledAt,
        deliveryId: "delivery-1",
      },
    })).rejects.toThrow("ownership does not match trusted scope");
    expect(repositoryCalls).toBe(0);
  });
});
