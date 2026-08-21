import { describe, expect, it, vi } from "vitest";
import {
  AwsAgentCoreCaptureCollectionTaskStarter,
  AwsCaptureCollectionRuntimeHandler,
  captureCollectionTaskKey,
  isAwsAgentCoreCaptureCollectionPayload,
} from "./capture-runtime.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const configuration = {
  region: "us-west-2",
  tenantId: scope.tenantId,
  runtimeArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/demo",
};

describe("AwsAgentCoreCaptureCollectionTaskStarter", () => {
  it("invokes AgentCore with trusted user identity and no tenant/workload secret in JSON", async () => {
    const invoke = vi.fn(async (request: { payload: string }) => {
      const parsed = JSON.parse(request.payload) as { captureSessionId: string };
      return JSON.stringify({
        kind: "CAPTURE_COLLECTION_STARTED",
        captureSessionId: parsed.captureSessionId,
      });
    });
    const starter = new AwsAgentCoreCaptureCollectionTaskStarter(configuration, { invoke });

    await starter.start({ scope, automationId: "auto-1", captureSessionId: "capture-1" });

    expect(invoke).toHaveBeenCalledOnce();
    const request = invoke.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      runtimeArn: configuration.runtimeArn,
      runtimeUserId: scope.userId,
    });
    expect(request?.payload).toContain('"kind":"CAPTURE_COLLECTION"');
    expect(request?.payload).not.toContain(scope.tenantId);
    expect(request?.payload).not.toContain("WorkloadAccessToken");
  });

  it("rejects cross-tenant launch before invoking AgentCore", async () => {
    const invoke = vi.fn(async () => "{}");
    const starter = new AwsAgentCoreCaptureCollectionTaskStarter(configuration, { invoke });

    await expect(starter.start({
      scope: { tenantId: "other", userId: scope.userId },
      automationId: "auto-1",
      captureSessionId: "capture-1",
    })).rejects.toThrow("configured tenant");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when Runtime acknowledges a different capture", async () => {
    const starter = new AwsAgentCoreCaptureCollectionTaskStarter(configuration, {
      async invoke() {
        return JSON.stringify({ kind: "CAPTURE_COLLECTION_STARTED", captureSessionId: "other" });
      },
    });
    await expect(starter.start({ scope, automationId: "auto-1", captureSessionId: "capture-1" }))
      .rejects.toThrow("acknowledgement identity mismatch");
  });
});

describe("AwsCaptureCollectionRuntimeHandler", () => {
  it("routes only trusted Runtime scope into the capture worker", async () => {
    const execute = vi.fn(async () => ({
      traceId: "trace-1",
      replayed: false,
      cleanupPending: false,
    }));
    const handler = new AwsCaptureCollectionRuntimeHandler({ execute });

    await expect(handler.handle({
      trustedScope: scope,
      headers: { WorkloadAccessToken: "must-not-be-forwarded" },
      payload: { kind: "CAPTURE_COLLECTION", automationId: "auto-1", captureSessionId: "capture-1" },
    })).resolves.toEqual({ traceId: "trace-1", replayed: false, cleanupPending: false });

    expect(execute).toHaveBeenCalledWith({
      scope,
      automationId: "auto-1",
      captureSessionId: "capture-1",
    });
  });

  it("recognizes capture payloads and derives stable in-memory task identity", () => {
    expect(isAwsAgentCoreCaptureCollectionPayload({ kind: "CAPTURE_COLLECTION" })).toBe(true);
    expect(isAwsAgentCoreCaptureCollectionPayload({ kind: "FRESH_TEST" })).toBe(false);
    expect(captureCollectionTaskKey({ scope, automationId: "auto-1", captureSessionId: "capture-1" }))
      .toBe(captureCollectionTaskKey({ scope, automationId: "auto-1", captureSessionId: "capture-1" }));
  });
});
