import { describe, expect, it } from "vitest";
import type { ReasoningRequest } from "@automation/core";
import {
  OpenAiByokReasoningProvider,
  OpenAiCredentialBoundReasoningProviderFactory,
  classifyOpenAiReasoningHttpError,
  type OpenAiFetch,
  type OpenAiFetchResponse,
} from "./index.js";

const node: ReasoningRequest["node"] = {
  id: "click-report",
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
    retryableFailureCodes: ["PROVIDER_RATE_LIMIT", "TRANSIENT_NETWORK"],
  },
  timeoutMs: 5_000,
  escalation: "SEMANTIC_RECOVERY",
};

const request: ReasoningRequest = {
  scope: { tenantId: "tenant-private", userId: "user-private" },
  automationId: "auto-private",
  runId: "run-private",
  node,
  objective: "Open the monthly report",
  context: { visibleText: "Monthly report", selectorHint: "button" },
  allowedActions: ["CLICK"],
};

function response(status: number, body: unknown): OpenAiFetchResponse {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function successBody(decision: unknown) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(decision),
          },
        ],
      },
    ],
  };
}

class FakeFetch {
  readonly calls: Array<{
    url: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  }> = [];
  next: OpenAiFetchResponse = response(
    200,
    successBody({
      summary: "Click the visible report button",
      action: "CLICK",
      arguments: [{ name: "role", value: "button" }],
      confidence: 0.93,
    }),
  );

  readonly fetch: OpenAiFetch = async (url, init) => {
    this.calls.push({
      url,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    });
    return this.next;
  };
}

describe("OpenAiByokReasoningProvider", () => {
  it("uses the fixed OpenAI Responses endpoint and structured output without ownership leakage", async () => {
    const transport = new FakeFetch();
    const provider = new OpenAiByokReasoningProvider(
      { model: "gpt-5.6-luna", timeoutMs: 5_000 },
      "sk-user-secret",
      transport.fetch,
    );

    const decision = await provider.decide(request);

    expect(decision).toEqual({
      summary: "Click the visible report button",
      action: "CLICK",
      arguments: { role: "button" },
      confidence: 0.93,
    });
    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/responses");
    expect(call?.headers.authorization).toBe("Bearer sk-user-secret");
    const body = call?.body ?? "";
    expect(body).toContain('"store":false');
    expect(body).toContain('"type":"json_schema"');
    expect(body).toContain('"enum":["CLICK"]');
    expect(body).toContain('"visibleText":"Monthly report"');
    expect(body).not.toContain(request.scope.tenantId);
    expect(body).not.toContain(request.scope.userId);
    expect(body).not.toContain(request.automationId);
    expect(body).not.toContain(request.runId);
  });

  it("blocks oversized page context before any provider request", async () => {
    const transport = new FakeFetch();
    const provider = new OpenAiByokReasoningProvider(
      { model: "gpt-5.6-luna", maxContextBytes: 32 },
      "sk-user-secret",
      transport.fetch,
    );

    await expect(
      provider.decide({ ...request, context: { page: "x".repeat(128) } }),
    ).rejects.toMatchObject({ failure: { code: "POLICY_BLOCKED" } });
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects actions outside the immutable workflow boundary", async () => {
    const transport = new FakeFetch();
    transport.next = response(
      200,
      successBody({
        summary: "Upload instead",
        action: "UPLOAD",
        arguments: [],
        confidence: 0.7,
      }),
    );
    const provider = new OpenAiByokReasoningProvider(
      { model: "gpt-5.6-luna" },
      "sk-user-secret",
      transport.fetch,
    );

    await expect(provider.decide(request)).rejects.toMatchObject({
      failure: { code: "POLICY_BLOCKED", retryable: false },
    });
  });

  it("rejects duplicate structured argument names instead of silently overwriting them", async () => {
    const transport = new FakeFetch();
    transport.next = response(
      200,
      successBody({
        summary: "Click button",
        action: "CLICK",
        arguments: [
          { name: "role", value: "button" },
          { name: "role", value: "link" },
        ],
        confidence: 0.8,
      }),
    );
    const provider = new OpenAiByokReasoningProvider(
      { model: "gpt-5.6-luna" },
      "sk-user-secret",
      transport.fetch,
    );

    await expect(provider.decide(request)).rejects.toMatchObject({
      failure: { code: "POLICY_BLOCKED" },
    });
  });

  it("sanitizes provider authentication errors and never surfaces the provider response body", async () => {
    const transport = new FakeFetch();
    transport.next = response(401, {
      error: {
        code: "invalid_api_key",
        message: "sk-user-secret raw provider error",
      },
    });
    const provider = new OpenAiByokReasoningProvider(
      { model: "gpt-5.6-luna" },
      "sk-user-secret",
      transport.fetch,
    );

    try {
      await provider.decide(request);
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toMatchObject({
        failure: {
          code: "PROVIDER_AUTH_INVALID",
          retryable: false,
          message: "OpenAI reasoning credential is invalid",
        },
      });
      expect(JSON.stringify(error)).not.toContain("sk-user-secret");
      expect(JSON.stringify(error)).not.toContain("raw provider error");
    }
  });

  it("classifies quota exhaustion separately from ordinary rate limiting", async () => {
    expect(
      classifyOpenAiReasoningHttpError(
        429,
        { error: { code: "insufficient_quota" } },
        "node-1",
      ).failure,
    ).toMatchObject({ code: "PROVIDER_QUOTA_EXHAUSTED", retryable: false });
    expect(
      classifyOpenAiReasoningHttpError(
        429,
        { error: { code: "rate_limit_exceeded" } },
        "node-1",
      ).failure,
    ).toMatchObject({ code: "PROVIDER_RATE_LIMIT", retryable: true });
  });

  it("treats server failures as retryable transient provider failures", () => {
    expect(
      classifyOpenAiReasoningHttpError(503, {}, "node-1").failure,
    ).toMatchObject({
      code: "TRANSIENT_NETWORK",
      retryable: true,
      nodeId: "node-1",
    });
  });
});

describe("OpenAiCredentialBoundReasoningProviderFactory", () => {
  it("binds only OpenAI credentials and rejects other providers", () => {
    const transport = new FakeFetch();
    const factory = new OpenAiCredentialBoundReasoningProviderFactory(
      { model: "gpt-5.6-luna" },
      transport.fetch,
    );

    expect(
      factory.create({
        provider: "OPENAI",
        credentialId: "cred-1",
        secret: { value: "sk-user-secret" },
      }),
    ).toBeInstanceOf(OpenAiByokReasoningProvider);
    expect(() =>
      factory.create({
        provider: "gemini",
        credentialId: "cred-2",
        secret: { value: "other-secret" },
      }),
    ).toThrow("unsupported BYOK reasoning provider");
  });
});
