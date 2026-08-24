import { describe, expect, it } from "vitest";
import type { FreshTestRunRequest } from "@automation/core";
import {
  AwsAgentCoreFreshTestExecutionPort,
  freshTestTaskKey,
  readAwsAgentCoreFreshTestConfiguration,
  type AgentCoreFreshTestInvokeApi,
  type AgentCoreFreshTestInvokeRequest,
} from "./fresh-test-runtime.js";

class FakeInvokeApi implements AgentCoreFreshTestInvokeApi {
  readonly calls: AgentCoreFreshTestInvokeRequest[] = [];

  async invoke(request: AgentCoreFreshTestInvokeRequest): Promise<string> {
    this.calls.push(structuredClone(request));
    return JSON.stringify({ kind: "ACCEPTED", runId: "test-run-1" });
  }
}

const configuration = {
  kind: "CONFIGURED" as const,
  region: "us-east-1",
  tenantId: "tenant-1",
  runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/runtime-1",
};

const request: FreshTestRunRequest = {
  scope: { tenantId: "tenant-1", userId: "user-1" },
  automationId: "auto-1",
  runId: "test-run-1",
  runtimeVariables: { customer: "Ada" },
};

describe("AwsAgentCoreFreshTestExecutionPort", () => {
  it("submits AgentCore work asynchronously with trusted runtimeUserId while keeping ownership and credentials out of JSON", async () => {
    const api = new FakeInvokeApi();
    const port = new AwsAgentCoreFreshTestExecutionPort(configuration, api);
    const result = await port.execute(request);

    expect(result).toEqual({ kind: "ACCEPTED", runId: "test-run-1" });
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0];
    expect(call?.runtimeArn).toBe(configuration.runtimeArn);
    expect(call?.runtimeUserId).toBe("user-1");
    expect(call?.runtimeSessionId.length).toBeGreaterThanOrEqual(33);
    const payload = JSON.parse(call?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toEqual({
      kind: "FRESH_TEST",
      automationId: "auto-1",
      runId: "test-run-1",
      runtimeVariables: { customer: "Ada" },
    });
    expect(call?.payload).not.toContain("tenant-1");
    expect(call?.payload).not.toContain("WorkloadAccessToken");
  });

  it("derives stable Runtime session and background-task identities from the authenticated scope and test run", async () => {
    const api = new FakeInvokeApi();
    const port = new AwsAgentCoreFreshTestExecutionPort(configuration, api);
    await port.execute(request);
    await port.execute(request);
    expect(api.calls[0]?.runtimeSessionId).toBe(api.calls[1]?.runtimeSessionId);
    expect(
      freshTestTaskKey({
        scope: request.scope,
        automationId: request.automationId,
        runId: request.runId,
      }),
    ).toBe(
      freshTestTaskKey({
        scope: request.scope,
        automationId: request.automationId,
        runId: request.runId,
      }),
    );
    expect(
      freshTestTaskKey({
        scope: { tenantId: "tenant-1", userId: "user-2" },
        automationId: request.automationId,
        runId: request.runId,
      }),
    ).not.toBe(
      freshTestTaskKey({
        scope: request.scope,
        automationId: request.automationId,
        runId: request.runId,
      }),
    );
  });

  it("rejects an acceptance response for a different run identity", async () => {
    const api: AgentCoreFreshTestInvokeApi = {
      async invoke() {
        return JSON.stringify({ kind: "ACCEPTED", runId: "other-run" });
      },
    };
    const port = new AwsAgentCoreFreshTestExecutionPort(configuration, api);
    await expect(port.execute(request)).rejects.toThrow(
      "AgentCore Runtime fresh-test acceptance identity is invalid",
    );
  });

  it("rejects cross-tenant composition before invoking AgentCore", async () => {
    const api = new FakeInvokeApi();
    const port = new AwsAgentCoreFreshTestExecutionPort(configuration, api);
    await expect(
      port.execute({
        ...request,
        scope: { tenantId: "tenant-2", userId: "user-1" },
      }),
    ).rejects.toThrow("fresh-test ownership does not match the configured tenant");
    expect(api.calls).toHaveLength(0);
  });

  it("reports missing Runtime deployment outputs explicitly", () => {
    expect(
      readAwsAgentCoreFreshTestConfiguration({ AWS_REGION: "us-east-1" }),
    ).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AUTOMATION_TENANT_ID", "AWS_AGENTCORE_RUNTIME_ARN"],
    });
  });
});
