import { describe, expect, it } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore, type CaptureSessionRecord, type OwnershipScope } from "@automation/core";
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
    return { sessionId: `session${this.starts.length}` };
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

class ActiveInMemoryCaptureSessionStore extends InMemoryCaptureSessionStore {
  private current: CaptureSessionRecord | null = null;

  override async putStarted(record: CaptureSessionRecord): Promise<void> {
    await super.putStarted(record);
    this.current = structuredClone(record);
  }

  async activeForAutomation(requestScope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null> {
    const current = this.current;
    if (
      !current ||
      current.status !== "STARTED" ||
      current.tenantId !== requestScope.tenantId ||
      current.userId !== requestScope.userId ||
      current.automationId !== automationId
    ) return null;
    return structuredClone(current);
  }
}

function starter(options: ConstructorParameters<typeof AgentCoreCaptureSessionStarter>[3] = {}) {
  const api = new FakeDataApi();
  const signer = new FakeLiveViewSigner();
  const sessionStore = new ActiveInMemoryCaptureSessionStore();
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
    expect(signer.calls).toEqual([{ browserIdentifier: "aws.browser.v1", sessionId: "session1", expiresInSeconds: 900 }]);
    expect(await sessionStore.get(scope, "capture-1")).toMatchObject({ browserSessionId: "session1", browserProfileRef: automation.browserProfileRef, status: "STARTED" });
  });

  it("rejects a second live capture before allocating another AgentCore Browser session", async () => {
    const { value, api, signer } = starter();
    await value.start(scope, automation);

    await expect(value.start(scope, automation)).rejects.toThrow(/already active/);
    expect(api.starts).toHaveLength(1);
    expect(signer.calls).toHaveLength(1);
  });

  it("allows a replacement after the durable active capture has expired", async () => {
    const api = new FakeDataApi();
    const signer = new FakeLiveViewSigner();
    const sessionStore = new ActiveInMemoryCaptureSessionStore();
    await sessionStore.putStarted({
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: automation.automationId,
      captureSessionId: "capture-old",
      browserSessionId: "session-old",
      browserProfileRef: automation.browserProfileRef ?? "",
      startedAt: "2026-08-19T22:00:00.000Z",
      expiresAt: "2026-08-19T23:00:00.000Z",
      status: "STARTED",
    });
    const value = new AgentCoreCaptureSessionStarter(api, signer, "aws.browser.v1", {
      sessionStore,
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      captureId: () => "capture-new",
    });

    await expect(value.start(scope, automation)).resolves.toMatchObject({ captureSessionId: "capture-new" });
    expect(api.starts).toHaveLength(1);
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
    expect(api.stops).toEqual([{ browserIdentifier: "aws.browser.v1", sessionId: "session1" }]);
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
