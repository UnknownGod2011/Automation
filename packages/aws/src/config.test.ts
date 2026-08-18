import { describe, expect, it } from "vitest";
import {
  AwsAdapterConfigurationPreflightCheck,
  DEFAULT_AGENTCORE_BROWSER_IDENTIFIER,
  DEFAULT_STRANDS_MODEL_ID,
  loadAwsAdapterConfig,
} from "./index.js";

describe("AWS adapter configuration", () => {
  it("loads region and production-safe adapter defaults through an explicit environment contract", () => {
    const result = loadAwsAdapterConfig({ AWS_REGION: "ap-south-1" });
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("expected configured result");
    expect(result.config.region).toBe("ap-south-1");
    expect(result.config.browserIdentifier).toBe(DEFAULT_AGENTCORE_BROWSER_IDENTIFIER);
    expect(result.config.browserSessionTimeoutSeconds).toBe(3_600);
    expect(result.config.strandsModelId).toBe(DEFAULT_STRANDS_MODEL_ID);
    expect(result.config.strandsMaxTokens).toBe(512);
    expect(result.config.reasoningContextMaxBytes).toBe(65_536);
  });

  it("accepts explicit Strands model and context limits", () => {
    const result = loadAwsAdapterConfig({
      AWS_REGION: "us-west-2",
      AWS_STRANDS_MODEL_ID: "custom-model-id",
      AWS_STRANDS_MAX_TOKENS: "1024",
      AWS_REASONING_CONTEXT_MAX_BYTES: "131072",
    });
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("expected configured result");
    expect(result.config.strandsModelId).toBe("custom-model-id");
    expect(result.config.strandsMaxTokens).toBe(1_024);
    expect(result.config.reasoningContextMaxBytes).toBe(131_072);
  });

  it("does not require static AWS access keys because workload roles are valid", () => {
    expect(loadAwsAdapterConfig({ AWS_REGION: "us-west-2" }).configured).toBe(true);
  });

  it("reports missing configuration as a durable preflight blocker", async () => {
    const result = loadAwsAdapterConfig({});
    const check = new AwsAdapterConfigurationPreflightCheck(result);
    const preflight = await check.check();
    expect(preflight.ready).toBe(false);
    if (preflight.ready) throw new Error("expected blocked preflight");
    expect(preflight.failure.code).toBe("NOT_CONFIGURED");
  });

  it("rejects AgentCore session TTLs outside the service range", () => {
    expect(() =>
      loadAwsAdapterConfig({
        AWS_REGION: "us-west-2",
        AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS: "28801",
      }),
    ).toThrow(/between 1 and 28800/);
  });

  it("rejects unsafe reasoning context and token limits", () => {
    expect(() =>
      loadAwsAdapterConfig({
        AWS_REGION: "us-west-2",
        AWS_REASONING_CONTEXT_MAX_BYTES: "10",
      }),
    ).toThrow(/AWS_REASONING_CONTEXT_MAX_BYTES/);
    expect(() =>
      loadAwsAdapterConfig({
        AWS_REGION: "us-west-2",
        AWS_STRANDS_MAX_TOKENS: "0",
      }),
    ).toThrow(/AWS_STRANDS_MAX_TOKENS/);
  });
});
