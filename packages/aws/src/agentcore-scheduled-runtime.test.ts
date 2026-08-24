import type { ScheduledRunWorkerResult } from "@automation/core";
import { describe, expect, it } from "vitest";
import {
  AGENTCORE_RUNTIME_USER_ID_HEADER,
  AwsAgentCoreScheduledRuntimeEntrypoint,
  createAwsAgentCoreScheduledRuntime,
  createAwsAgentCoreScheduledRuntimeInvocationFromHttp,
  readAwsAgentCoreScheduledRuntimeConfiguration,
} from "./agentcore-scheduled-runtime.js";
import type { AwsScheduledRunInvocation } from "./scheduled-run-handler.js";

const blockedResult: ScheduledRunWorkerResult = {
  kind: "NOT_RUN",
  preparation: {
    kind: "BLOCKED",
    run: {
      tenantId: "tenant-prod",
      userId: "user-1",
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 1,
      occurrenceKey: "auto-1:2026-08-20T06:00:00.000Z",
      status: "WAITING_FOR_HUMAN",
      scheduledAt: "2026-08-20T06:00:00.000Z",
      failure: {
        code: "NOT_CONFIGURED",
        message: "test stop",
        retryable: false,
        evidenceRefs: [],
      },
    },
  },
  cleanupWarnings: [],
};

describe("AgentCore scheduled runtime configuration", () => {
  it("fails closed when the deployment-owned tenant is missing", () => {
    expect(readAwsAgentCoreScheduledRuntimeConfiguration({})).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AUTOMATION_TENANT_ID"],
    });
    expect(
      readAwsAgentCoreScheduledRuntimeConfiguration({
        AUTOMATION_TENANT_ID: " tenant-prod ",
      }),
    ).toEqual({ kind: "CONFIGURED", tenantId: "tenant-prod" });
  });

  it("aggregates runtime and scheduled-worker deployment gaps", () => {
    expect(createAwsAgentCoreScheduledRuntime({ env: {} })).toEqual({
      kind: "NOT_CONFIGURED",
      missing: [
        "AUTOMATION_TENANT_ID",
        "AWS_REGION (or AWS_DEFAULT_REGION)",
        "AWS_DYNAMODB_TABLE",
        "AWS_ARTIFACT_BUCKET",
        "OPENAI_BYOK_MODEL",
      ],
    });
  });
});

describe("AgentCore Runtime HTTP invocation boundary", () => {
  it("derives Runtime user identity from a case-insensitive managed header", () => {
    const payload = { automationId: "auto-1" };
    expect(
      createAwsAgentCoreScheduledRuntimeInvocationFromHttp({
        headers: {
          "X-Amzn-Bedrock-AgentCore-Runtime-User-Id": "user-1",
          WorkloadAccessToken: "runtime-token",
        },
        payload,
      }),
    ).toEqual({
      runtimeUserId: "user-1",
      headers: {
        [AGENTCORE_RUNTIME_USER_ID_HEADER]: "user-1",
        workloadaccesstoken: "runtime-token",
      },
      payload,
    });
  });

  it("fails closed on ambiguous multi-valued or conflicting managed headers", () => {
    expect(() =>
      createAwsAgentCoreScheduledRuntimeInvocationFromHttp({
        headers: { WorkloadAccessToken: ["token-a", "token-b"] },
        payload: {},
      }),
    ).toThrow("multi-valued invocation header");

    expect(() =>
      createAwsAgentCoreScheduledRuntimeInvocationFromHttp({
        headers: {
          WorkloadAccessToken: "token-a",
          workloadaccesstoken: "token-b",
        },
        payload: {},
      }),
    ).toThrow("conflicting invocation headers");
  });
});

describe("AwsAgentCoreScheduledRuntimeEntrypoint", () => {
  it("derives trusted ownership from deployment tenant and Runtime user identity", async () => {
    let observed: AwsScheduledRunInvocation | undefined;
    const entrypoint = new AwsAgentCoreScheduledRuntimeEntrypoint(
      { kind: "CONFIGURED", tenantId: "tenant-prod" },
      {
        async handle(invocation) {
          observed = invocation;
          return blockedResult;
        },
      },
    );
    const payload = {
      schemaVersion: 1,
      scope: { tenantId: "tenant-prod", userId: "user-1" },
      automationId: "auto-1",
      scheduleId: "schedule-1",
      scheduledAt: "2026-08-20T06:00:00.000Z",
      deliveryId: "delivery-1",
    };

    await expect(
      entrypoint.handle({
        runtimeUserId: " user-1 ",
        headers: { WorkloadAccessToken: "runtime-token" },
        payload,
      }),
    ).resolves.toEqual(blockedResult);

    expect(observed).toEqual({
      trustedScope: { tenantId: "tenant-prod", userId: "user-1" },
      headers: { WorkloadAccessToken: "runtime-token" },
      payload,
    });
  });

  it("rejects missing or oversized Runtime user identity before worker execution", async () => {
    let handlerCalls = 0;
    const entrypoint = new AwsAgentCoreScheduledRuntimeEntrypoint(
      { kind: "CONFIGURED", tenantId: "tenant-prod" },
      {
        async handle() {
          handlerCalls += 1;
          return blockedResult;
        },
      },
    );

    await expect(
      entrypoint.handle({ runtimeUserId: "   ", headers: {}, payload: {} }),
    ).rejects.toThrow("Runtime user identity is invalid");
    await expect(
      entrypoint.handle({ runtimeUserId: "u".repeat(129), headers: {}, payload: {} }),
    ).rejects.toThrow("Runtime user identity is invalid");
    expect(handlerCalls).toBe(0);
  });
});
