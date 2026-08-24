import { describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "@automation/contracts";
import type { ArtifactStore } from "@automation/core";
import {
  AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory,
  type PlaywrightReconciliationBrowser,
  type PlaywrightReconciliationConnect,
} from "./human-resume-reconciliation-runtime.js";

class FakeLocator {
  constructor(private readonly visible: boolean) {}
  first() { return this; }
  async isVisible() { return this.visible; }
}

class FakePage {
  url() { return "https://example.com/saved"; }
  async title() { return "Saved"; }
  getByText() { return new FakeLocator(true); }
  locator() { return new FakeLocator(true); }
}

class FakeArtifacts implements ArtifactStore {
  puts = 0;
  async put(_scope: unknown, path: string, content: Uint8Array, contentType: string) {
    this.puts += 1;
    return { ref: `artifact://${path}`, contentType, sizeBytes: content.byteLength };
  }
  async get() { return null; }
}

const node: WorkflowNode = {
  id: "click-1",
  kind: "CLICK",
  objective: "submit once",
  deterministicStrategies: [{ kind: "TEXT", value: "Submit" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["submit-form"],
  verification: {
    description: "saved marker",
    mode: "TEXT",
    expected: "Saved",
    timeoutMs: 1_000,
  },
  retryPolicy: {
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
    jitter: false,
    retryableFailureCodes: [],
  },
  timeoutMs: 1_000,
  next: ["end"],
  escalation: "HUMAN",
};

const run = {
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 3,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN" as const,
  scheduledAt: "2026-08-19T00:00:00.000Z",
  currentNodeId: "human-1",
};

function browser(page = new FakePage()) {
  let closes = 0;
  const value: PlaywrightReconciliationBrowser = {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    close: async () => { closes += 1; },
  };
  return { value, get closes() { return closes; } };
}

describe("AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory", () => {
  it("creates only an observation verifier plus cleanup and forwards connection settings", async () => {
    const artifacts = new FakeArtifacts();
    const fakeBrowser = browser();
    const connect = vi.fn<PlaywrightReconciliationConnect>(async () => fakeBrowser.value);
    const factory = new AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory(
      artifacts,
      1_234,
      connect,
    );

    const runtime = await factory.create(
      { tenantId: "tenant-1", userId: "user-1" },
      run,
      {
        sessionId: "session-1",
        connection: { endpoint: "wss://browser.invalid", headers: { "x-session": "opaque" } },
      },
    );

    expect(Object.keys(runtime).sort()).toEqual(["close", "verifier"]);
    expect(connect).toHaveBeenCalledWith("wss://browser.invalid", {
      headers: { "x-session": "opaque" },
      timeout: 1_234,
    });
    await expect(runtime.verifier.inspect({
      scope: { tenantId: "tenant-1", userId: "user-1" },
      runId: "run-1",
      humanNodeId: "human-1",
      resolutionId: "resolution-1",
      effectId: "effect-1",
      node,
      verification: node.verification!,
    })).resolves.toMatchObject({ decision: "ALREADY_APPLIED" });
    expect(artifacts.puts).toBe(1);

    await runtime.close();
    expect(fakeBrowser.closes).toBe(1);
  });

  it("closes a connected browser when runtime setup fails", async () => {
    let closes = 0;
    const connect: PlaywrightReconciliationConnect = async () => ({
      contexts: () => [],
      close: async () => { closes += 1; },
    });
    const factory = new AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory(
      new FakeArtifacts(),
      1_000,
      connect,
    );

    await expect(factory.create(
      { tenantId: "tenant-1", userId: "user-1" },
      run,
      { sessionId: "session-1", connection: { endpoint: "wss://browser.invalid", headers: {} } },
    )).rejects.toMatchObject({
      failure: { code: "UNKNOWN", retryable: false, message: "AgentCore Browser reconciliation runtime setup failed" },
    });
    expect(closes).toBe(1);
  });

  it("classifies uncertain connection failures with a fixed message", async () => {
    const connect: PlaywrightReconciliationConnect = async () => {
      throw new Error("websocket timed out");
    };
    const factory = new AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory(
      new FakeArtifacts(),
      1_000,
      connect,
    );

    await expect(factory.create(
      { tenantId: "tenant-1", userId: "user-1" },
      run,
      { sessionId: "session-1", connection: { endpoint: "wss://browser.invalid", headers: {} } },
    )).rejects.toMatchObject({
      failure: {
        code: "TRANSIENT_NETWORK",
        retryable: true,
        message: "AgentCore Browser reconciliation connection is temporarily unavailable",
      },
    });
  });

  it("rejects invalid connection timeout configuration", () => {
    expect(() => new AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory(
      new FakeArtifacts(),
      0,
      async () => browser().value,
    )).toThrow("positive safe integer");
  });
});
