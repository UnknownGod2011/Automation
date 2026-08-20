import type { RunRecord, WorkflowNode } from "@automation/contracts";
import type { AwsByokScheduledExecutionDependencies } from "./scheduled-execution-composition.js";
import type { AwsScheduledRunHandlerDependencies } from "./scheduled-run-handler.js";
import { describe, expect, it } from "vitest";
import {
  AwsScheduledRunHandler,
  readAwsScheduledRunHandlerConfiguration,
  scheduledOccurrenceRunId,
} from "./scheduled-run-handler.js";

const scope = { tenantId: "tenant-1", userId: "user-1" } as const;
const scheduledAt = "2026-08-20T06:00:00.000Z";

const reasonNode: WorkflowNode = {
  id: "reason-1",
  kind: "REASON",
  objective: "Choose the permitted action",
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
  timeoutMs: 1_000,
  escalation: "HUMAN",
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
    failure: {
      code: "NOT_CONFIGURED",
      message: "test stop",
      retryable: false,
      evidenceRefs: [],
    },
  };
}

function stubDependencies(
  runner: NonNullable<AwsScheduledRunHandlerDependencies["runner"]>,
  openAiFetch?: AwsScheduledRunHandlerDependencies["openAiFetch"],
): AwsScheduledRunHandlerDependencies {
  return {
    coordinator: {
      automations: null as never,
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
    runner,
    ...(openAiFetch ? { openAiFetch } : {}),
  };
}

function envelope(deliveryId: string) {
  return {
    schemaVersion: 1 as const,
    scope,
    automationId: "auto-1",
    scheduleId: "schedule-1",
    scheduledAt,
    deliveryId,
  };
}

describe("scheduled-run handler configuration", () => {
  it("exposes missing OpenAI model as NOT_CONFIGURED", () => {
    expect(readAwsScheduledRunHandlerConfiguration({})).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["OPENAI_BYOK_MODEL"],
    });
    expect(readAwsScheduledRunHandlerConfiguration({ OPENAI_BYOK_MODEL: " gpt-5-mini " })).toEqual({
      kind: "CONFIGURED",
      openAiModel: "gpt-5-mini",
    });
  });
});

describe("AwsScheduledRunHandler", () => {
  it("binds one trusted occurrence to workload identity, OpenAI BYOK, and the worker", async () => {
    let observedComposition: AwsByokScheduledExecutionDependencies | undefined;
    let observedModel: string | undefined;
    let fetchCalls = 0;
    const fetchImpl: NonNullable<AwsScheduledRunHandlerDependencies["openAiFetch"]> = async (
      _url,
      init,
    ) => {
      fetchCalls += 1;
      const body = JSON.parse(init.body) as { model?: string };
      observedModel = body.model;
      return {
        status: 200,
        async text() {
          return JSON.stringify({
            status: "completed",
            output: [{
              type: "message",
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  summary: "click",
                  action: "CLICK",
                  arguments: [],
                  confidence: 0.9,
                }),
              }],
            }],
          });
        },
      };
    };

    const runner: NonNullable<AwsScheduledRunHandlerDependencies["runner"]> = async (
      composition,
      request,
    ) => {
      observedComposition = composition;
      expect(composition.workloadAccessToken.get()).toBe("trusted-workload-token");
      expect(request.runId).toBe(scheduledOccurrenceRunId(scope, "auto-1", scheduledAt));
      const provider = composition.credentials.providers.create({
        provider: "openai",
        credentialId: "cred-1",
        secret: { value: "sk-test" },
      });
      await provider.decide({
        scope,
        automationId: "auto-1",
        runId: request.runId,
        node: reasonNode,
        objective: reasonNode.objective,
        allowedActions: ["CLICK"],
        context: { visibleText: "Approve" },
      });
      return {
        kind: "NOT_RUN",
        preparation: { kind: "BLOCKED", run: blockedRun(request.runId) },
        cleanupWarnings: [],
      };
    };

    const configuration = readAwsScheduledRunHandlerConfiguration({
      OPENAI_BYOK_MODEL: "gpt-5-mini",
    });
    if (configuration.kind !== "CONFIGURED") throw new Error("test configuration missing");
    const handler = new AwsScheduledRunHandler(
      configuration,
      stubDependencies(runner, fetchImpl),
    );

    await handler.handle({
      trustedScope: scope,
      headers: { WorkloadAccessToken: "trusted-workload-token" },
      payload: JSON.stringify(envelope("delivery-1")),
    });

    expect(observedComposition?.scope).toEqual(scope);
    expect(observedModel).toBe("gpt-5-mini");
    expect(fetchCalls).toBe(1);
  });

  it("rejects spoofed ownership before composing execution", async () => {
    let runnerCalls = 0;
    const runner: NonNullable<AwsScheduledRunHandlerDependencies["runner"]> = async (
      _composition,
      request,
    ) => {
      runnerCalls += 1;
      return {
        kind: "NOT_RUN",
        preparation: { kind: "BLOCKED", run: blockedRun(request.runId) },
        cleanupWarnings: [],
      };
    };
    const configuration = readAwsScheduledRunHandlerConfiguration({
      OPENAI_BYOK_MODEL: "gpt-5-mini",
    });
    if (configuration.kind !== "CONFIGURED") throw new Error("test configuration missing");
    const handler = new AwsScheduledRunHandler(configuration, stubDependencies(runner));

    await expect(handler.handle({
      trustedScope: scope,
      headers: { WorkloadAccessToken: "trusted-workload-token" },
      payload: {
        ...envelope("delivery-1"),
        scope: { tenantId: "tenant-2", userId: "user-2" },
      },
    })).rejects.toThrow("ownership does not match trusted scope");
    expect(runnerCalls).toBe(0);
  });

  it("uses occurrence identity rather than delivery identity for duplicate dispatches", () => {
    const first = scheduledOccurrenceRunId(scope, "auto-1", scheduledAt);
    const second = scheduledOccurrenceRunId(scope, "auto-1", scheduledAt);
    expect(first).toBe(second);
    expect(first).toMatch(/^run-[0-9a-f]+$/);
  });
});
