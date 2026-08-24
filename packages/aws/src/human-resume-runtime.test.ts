import { describe, expect, it, vi } from "vitest";
import type { HumanResumeSubmission } from "@automation/core";
import {
  AwsAgentCoreHumanResumeExecutionPort,
  type AgentCoreFreshTestInvokeApi,
} from "./index.js";

describe("AwsAgentCoreHumanResumeExecutionPort", () => {
  it("keeps tenant authority and workload capability out of the Runtime JSON payload", async () => {
    const invoke = vi.fn<AgentCoreFreshTestInvokeApi["invoke"]>(async () => JSON.stringify({
      kind: "RESUMED",
      runId: "run-1",
      status: "SUCCEEDED",
    }));
    const port = new AwsAgentCoreHumanResumeExecutionPort({
      kind: "CONFIGURED",
      region: "us-east-1",
      tenantId: "tenant-a",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example",
    }, { invoke });
    const request: HumanResumeSubmission = {
      scope: { tenantId: "tenant-a", userId: "user-a" },
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "human-approve",
      resolutionId: "web-human-step-v1",
    };

    await expect(port.execute(request)).resolves.toEqual({
      kind: "RESUMED",
      runId: "run-1",
      status: "SUCCEEDED",
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    const invocation = invoke.mock.calls[0]?.[0];
    expect(invocation?.runtimeUserId).toBe("user-a");
    const payload = JSON.parse(invocation?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toEqual({
      kind: "HUMAN_RESUME",
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "human-approve",
      resolutionId: "web-human-step-v1",
    });
    expect(JSON.stringify(payload)).not.toContain("tenant-a");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("workload");
  });

  it("rejects cross-tenant use before AgentCore invocation", async () => {
    const invoke = vi.fn<AgentCoreFreshTestInvokeApi["invoke"]>();
    const port = new AwsAgentCoreHumanResumeExecutionPort({
      kind: "CONFIGURED",
      region: "us-east-1",
      tenantId: "tenant-a",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example",
    }, { invoke });

    await expect(port.execute({
      scope: { tenantId: "tenant-b", userId: "user-a" },
      automationId: "auto-1",
      runId: "run-1",
      expectedNodeId: "human-approve",
      resolutionId: "web-human-step-v1",
    })).rejects.toThrow("ownership");
    expect(invoke).not.toHaveBeenCalled();
  });
});
