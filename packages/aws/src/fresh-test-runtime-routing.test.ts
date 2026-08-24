import { describe, expect, it } from "vitest";
import type { ScheduledRunWorkerResult } from "@automation/core";
import { AwsAgentCoreScheduledRuntimeEntrypoint } from "./agentcore-scheduled-runtime.js";

const scheduledResult: ScheduledRunWorkerResult = {
  kind: "NOT_RUN",
  preparation: {
    kind: "DUPLICATE",
    run: {
      tenantId: "tenant-prod",
      userId: "user-1",
      runId: "scheduled-1",
      automationId: "auto-1",
      workflowVersion: 1,
      occurrenceKey: "auto-1:scheduled",
      status: "SUCCEEDED",
      scheduledAt: "2026-08-20T15:00:00.000Z",
    },
  },
  cleanupWarnings: [],
};

const freshResult = {
  kind: "DUPLICATE" as const,
  run: {
    tenantId: "tenant-prod",
    userId: "user-1",
    runId: "fresh-1",
    automationId: "auto-1",
    workflowVersion: 2,
    occurrenceKey: "auto-1:test:fresh-1",
    status: "SUCCEEDED" as const,
    scheduledAt: "2026-08-20T15:00:00.000Z",
  },
  checkpoint: null,
};

describe("AgentCore execution-plane routing", () => {
  it("routes explicit FRESH_TEST payloads only to the fresh-test handler", async () => {
    let scheduledCalls = 0;
    let freshCalls = 0;
    const entrypoint = new AwsAgentCoreScheduledRuntimeEntrypoint(
      { kind: "CONFIGURED", tenantId: "tenant-prod" },
      {
        async handle() {
          scheduledCalls += 1;
          return scheduledResult;
        },
      },
      {
        async handle(invocation) {
          freshCalls += 1;
          expect(invocation.trustedScope).toEqual({
            tenantId: "tenant-prod",
            userId: "user-1",
          });
          return freshResult;
        },
      },
    );

    await expect(
      entrypoint.handle({
        runtimeUserId: "user-1",
        headers: { WorkloadAccessToken: "runtime-token" },
        payload: {
          kind: "FRESH_TEST",
          automationId: "auto-1",
          runId: "fresh-1",
        },
      }),
    ).resolves.toEqual(freshResult);
    expect(freshCalls).toBe(1);
    expect(scheduledCalls).toBe(0);
  });

  it("keeps ordinary scheduled payloads on the scheduled handler", async () => {
    let scheduledCalls = 0;
    let freshCalls = 0;
    const entrypoint = new AwsAgentCoreScheduledRuntimeEntrypoint(
      { kind: "CONFIGURED", tenantId: "tenant-prod" },
      {
        async handle() {
          scheduledCalls += 1;
          return scheduledResult;
        },
      },
      {
        async handle() {
          freshCalls += 1;
          return freshResult;
        },
      },
    );

    await entrypoint.handle({
      runtimeUserId: "user-1",
      headers: {},
      payload: { schemaVersion: 1, automationId: "auto-1" },
    });
    expect(scheduledCalls).toBe(1);
    expect(freshCalls).toBe(0);
  });
});
