import { describe, expect, it } from "vitest";
import type { ReasoningRequest } from "@automation/core";
import {
  AwsStrandsReasoningProvider,
  classifyAwsReasoningError,
  type StructuredDecisionInvoker,
} from "./index.js";

const node: ReasoningRequest["node"] = {
  id: "click",
  kind: "CLICK",
  objective: "Choose the safe click",
  deterministicStrategies: [],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["navigation"],
  retryPolicy: {
    maxAttempts: 2,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
    jitter: false,
    retryableFailureCodes: ["PROVIDER_RATE_LIMIT"],
  },
  timeoutMs: 5_000,
  escalation: "SEMANTIC_RECOVERY",
};

const request: ReasoningRequest = {
  scope: { tenantId: "tenant-secret-id", userId: "user-secret-id" },
  automationId: "auto-1",
  runId: "run-1",
  node,
  objective: "Open the report",
  context: { visibleText: "Report", selectorHint: "button" },
  allowedActions: ["CLICK"],
};

class FakeInvoker implements StructuredDecisionInvoker {
  readonly calls: { prompt: string; allowedActions: readonly string[] }[] = [];
  output: unknown = {
    summary: "Click the visible report button",
    action: "CLICK",
    arguments: { role: "button" },
    confidence: 0.93,
  };
  error: unknown;

  async invoke(prompt: string, allowedActions: readonly string[]) {
    this.calls.push({ prompt, allowedActions: [...allowedActions] });
    if (this.error) throw this.error;
    return structuredClone(this.output);
  }
}

describe("AwsStrandsReasoningProvider", () => {
  it("builds a bounded decision prompt without leaking ownership identifiers", async () => {
    const invoker = new FakeInvoker();
    const provider = new AwsStrandsReasoningProvider(invoker, 4_096);

    const decision = await provider.decide(request);

    expect(decision.action).toBe("CLICK");
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0]?.allowedActions).toEqual(["CLICK"]);
    expect(invoker.calls[0]?.prompt).toContain("BEGIN_UNTRUSTED_CONTEXT_JSON");
    expect(invoker.calls[0]?.prompt).toContain('"visibleText":"Report"');
    expect(invoker.calls[0]?.prompt).not.toContain(request.scope.tenantId);
    expect(invoker.calls[0]?.prompt).not.toContain(request.scope.userId);
  });

  it("blocks oversized untrusted context before invoking the model", async () => {
    const invoker = new FakeInvoker();
    const provider = new AwsStrandsReasoningProvider(invoker, 32);

    await expect(
      provider.decide({ ...request, context: { page: "x".repeat(100) } }),
    ).rejects.toMatchObject({
      failure: { code: "POLICY_BLOCKED" },
    });
    expect(invoker.calls).toHaveLength(0);
  });

  it("rejects a structured decision outside the workflow action boundary", async () => {
    const invoker = new FakeInvoker();
    invoker.output = {
      summary: "Try a different action",
      action: "UPLOAD",
      arguments: {},
      confidence: 0.8,
    };
    const provider = new AwsStrandsReasoningProvider(invoker, 4_096);

    await expect(provider.decide(request)).rejects.toMatchObject({
      failure: { code: "POLICY_BLOCKED" },
    });
  });

  it("classifies throttling without persisting raw provider error text", async () => {
    const invoker = new FakeInvoker();
    invoker.error = Object.assign(new Error("raw request body with private data"), {
      name: "ThrottlingException",
      $metadata: { httpStatusCode: 429 },
    });
    const provider = new AwsStrandsReasoningProvider(invoker, 4_096);

    try {
      await provider.decide(request);
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toMatchObject({
        failure: {
          code: "PROVIDER_RATE_LIMIT",
          retryable: true,
          message: "AWS reasoning provider is temporarily rate limited",
        },
      });
      expect(JSON.stringify(error)).not.toContain("raw request body");
    }
  });
});

describe("classifyAwsReasoningError", () => {
  it("maps missing workload credentials to NOT_CONFIGURED", () => {
    const error = Object.assign(new Error("credential chain details"), {
      name: "CredentialsProviderError",
    });
    expect(classifyAwsReasoningError(error, "node-1").failure).toMatchObject({
      code: "NOT_CONFIGURED",
      retryable: false,
      nodeId: "node-1",
    });
  });

  it("maps server failures to retryable transient network errors", () => {
    const error = Object.assign(new Error("internal service body"), {
      name: "ServiceUnavailableException",
      $metadata: { httpStatusCode: 503 },
    });
    expect(classifyAwsReasoningError(error, "node-1").failure).toMatchObject({
      code: "TRANSIENT_NETWORK",
      retryable: true,
    });
  });
});
