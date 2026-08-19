import { describe, expect, it } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "@automation/core";
import {
  AgentCoreCaptureSessionStarter,
  profileRef,
  type AgentCoreBrowserDataApi,
  type AgentCoreBrowserLiveViewSigner,
  type AgentCoreBrowserSessionSaveInput,
  type AgentCoreBrowserSessionStartInput,
} from "./index.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const profileId = "automation_profile-1234567890";
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Capture demo",
  websiteUrl: "https://example.com/",
  prompt: "Submit the saved form",
  status: "DRAFT",
  browserProfileRef: profileRef(profileId),
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

class FakeDataApi implements AgentCoreBrowserDataApi {
  readonly starts: AgentCoreBrowserSessionStartInput[] = [];
  readonly saves: AgentCoreBrowserSessionSaveInput[] = [];
  readonly stops: { browserIdentifier: string; sessionId: string }[] = [];

  async start(input: AgentCoreBrowserSessionStartInput) {
    this.starts.push(structuredClone(input));
    return { sessionId: "session123" };
  }
  async save(input: AgentCoreBrowserSessionSaveInput) { this.saves.push(structuredClone(input)); }
  async stop(browserIdentifier: string, sessionId: string) { this.stops.push({ browserIdentifier, sessionId }); }
}

class FakeLiveViewSigner implements AgentCoreBrowserLiveViewSigner {
  readonly calls: { browserIdentifier: string; sessionId: string; expiresInSeconds: number }[] = [];
  url = "https://bedrock-agentcore.us-west-2.amazonaws.com/live-view?signed=1";
  error: unknown;
  async sign(browserIdentifier: string, sessionId: string, expiresInSeconds: number) {
    this.calls.push({ browserIdentifier, sessionId, expiresInSeconds });
    if (this.error) throw this.error;
    return this.url;
  }
}

function starter(options: ConstructorParameters<typeof AgentCoreCaptureSessionStarter>[3] = {}) {
  const api = new FakeDataApi();
  const signer = new FakeLiveViewSigner();
  const sessionStore = new InMemoryCaptureSessionStore();
  return {
    api,
    signer,
    sessionStore,
    value: new AgentCoreCaptureSessionStarter(api, signer, "aws.browser.v1", {
      sessionStore,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      captureId: () => "capture-1",
      ...options,
    }),
  };
}

describe("AgentCoreCaptureSessionStarter", () => {
  it("starts an isolated profiled AgentCore session, durably registers it, and returns a bounded Live View URL", async () => {
    const { value, api, signer, sessionStore } = starter({ sessionTimeoutSeconds: 3_600, liveViewTtlSeconds: 900, viewport: { width: 1_440, height: 900 } });
    const result = await value.start(scope, automation);
    expect(result).toEqual({ kind: "READY", captureSessionId: "capture-1", liveViewUrl: "https://bedrock-agentcore.us-west-2.amazonaws.com/live-view?signed=1", expiresAt: "2026-08-20T00:15:00.000Z" });
    expect(api.starts[0]).toMatchObject({ browserIdentifier: "aws.browser.v1", timeoutSeconds: 3_600, profileIdentifier: profileId, viewport: { width: 1_440, height: 900 } });
    expect(signer.calls).toEqual([{ browserIdentifier: "aws.browser.v1", sessionId: "session123", expiresInSeconds: 900 }]);
    expect(await sessionStore.get(scope, "capture-1")).toMatchObject({ browserSessionId: "session123", browserProfileRef: automation.browserProfileRef, status: "STARTED" });
  });

  it("rejects cross-tenant automation objects before creating browser compute", async () => {
    const { value, api } = starter();
    await expect(value.start(scope, { ...automation, tenantId: "tenant-other" })).rejects.toThrow(/ownership scope/);
    expect(api.starts).toHaveLength(0);
  });

  it("requires an owned AgentCore browser profile before capture", async () => {
    const { value, api } = starter();
    const withoutProfile = structuredClone(automation);
    delete withoutProfile.browserProfileRef;
    await expect(value.start(scope, withoutProfile)).rejects.toThrow(/browser profile is required/);
    expect(api.starts).toHaveLength(0);
  });

  it("requires durable capture metadata before creating cloud resources", async () => {
    const api = new FakeDataApi();
    const signer = new FakeLiveViewSigner();
    const value = new AgentCoreCaptureSessionStarter(api, signer, "aws.browser.v1");
    await expect(value.start(scope, automation)).rejects.toThrow(/durable capture session store/);
    expect(api.starts).toHaveLength(0);
  });

  it("stops the newly-created browser session when Live View signing fails", async () => {
    const { value, api, signer } = starter();
    signer.error = new Error("signing failed");
    await expect(value.start(scope, automation)).rejects.toThrow(/signing failed/);
    expect(api.stops).toEqual([{ browserIdentifier: "aws.browser.v1", sessionId: "session123" }]);
  });

  it("rejects unsafe Live View URLs and cleans up the browser session", async () => {
    const { value, api, signer } = starter();
    signer.url = "http://example.com/live-view";
    await expect(value.start(scope, automation)).rejects.toThrow(/must use HTTPS/);
    expect(api.stops).toHaveLength(1);
  });

  it("validates capture timeout and Live View TTL before creating cloud resources", () => {
    expect(() => starter({ sessionTimeoutSeconds: 28_801 })).toThrow(/capture session timeout/);
    expect(() => starter({ sessionTimeoutSeconds: 600, liveViewTtlSeconds: 601 })).toThrow(/Live View URL TTL/);
  });
});
