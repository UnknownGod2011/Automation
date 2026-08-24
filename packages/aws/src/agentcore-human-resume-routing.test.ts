import { describe, expect, it, vi } from "vitest";
import { AwsAgentCoreScheduledRuntimeEntrypoint } from "./agentcore-scheduled-runtime.js";

describe("AgentCore Runtime human resume routing", () => {
  it("routes HUMAN_RESUME through trusted Runtime ownership instead of the scheduled handler", async () => {
    const scheduled = { handle: vi.fn(async () => { throw new Error("scheduled handler should not run"); }) };
    const human = {
      handle: vi.fn(async () => ({
        kind: "RESUMED" as const,
        runId: "run-1",
        status: "SUCCEEDED" as const,
      })),
    };
    const entrypoint = new AwsAgentCoreScheduledRuntimeEntrypoint(
      { kind: "CONFIGURED", tenantId: "tenant-a" },
      scheduled,
      undefined,
      undefined,
      human,
    );

    await expect(entrypoint.handle({
      runtimeUserId: "user-a",
      headers: { workloadaccesstoken: "runtime-capability" },
      payload: {
        kind: "HUMAN_RESUME",
        automationId: "auto-1",
        runId: "run-1",
        expectedNodeId: "human-approve",
        resolutionId: "web-human-step-v1",
      },
    })).resolves.toEqual({ kind: "RESUMED", runId: "run-1", status: "SUCCEEDED" });

    expect(human.handle).toHaveBeenCalledWith(expect.objectContaining({
      trustedScope: { tenantId: "tenant-a", userId: "user-a" },
    }));
    expect(scheduled.handle).not.toHaveBeenCalled();
  });
});
