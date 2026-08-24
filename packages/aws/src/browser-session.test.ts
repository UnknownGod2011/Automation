import { describe, expect, it } from "vitest";
import type { BrowserAutomationConnection, BrowserSessionHandle } from "@automation/core";
import {
  AgentCoreBrowserSessionManager,
  profileRef,
  type AgentCoreBrowserConnectionSigner,
  type AgentCoreBrowserDataApi,
  type AgentCoreBrowserSessionSaveInput,
  type AgentCoreBrowserSessionStartInput,
} from "./index.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const profileId = "automation_profile-1234567890";

class FakeDataApi implements AgentCoreBrowserDataApi {
  readonly starts: AgentCoreBrowserSessionStartInput[] = [];
  readonly saves: AgentCoreBrowserSessionSaveInput[] = [];
  readonly stops: { browserIdentifier: string; sessionId: string }[] = [];
  startSessionId = "session123";
  stopError: unknown;

  async start(input: AgentCoreBrowserSessionStartInput) {
    this.starts.push(structuredClone(input));
    return { sessionId: this.startSessionId };
  }

  async save(input: AgentCoreBrowserSessionSaveInput) {
    this.saves.push(structuredClone(input));
  }

  async stop(browserIdentifier: string, sessionId: string) {
    this.stops.push({ browserIdentifier, sessionId });
    if (this.stopError) throw this.stopError;
  }
}

class FakeSigner implements AgentCoreBrowserConnectionSigner {
  readonly calls: { browserIdentifier: string; sessionId: string }[] = [];
  error: unknown;
  connection: BrowserAutomationConnection = {
    endpoint: "wss://bedrock-agentcore.example/automation",
    headers: { authorization: "signed" },
  };

  async sign(browserIdentifier: string, sessionId: string) {
    this.calls.push({ browserIdentifier, sessionId });
    if (this.error) throw this.error;
    return structuredClone(this.connection);
  }
}

const request = {
  automationId: "auto-1",
  runId: "run-1",
  profileRef: profileRef(profileId),
  timeoutSeconds: 3_600,
  viewport: { width: 1_440, height: 900 },
};

function manager() {
  const api = new FakeDataApi();
  const signer = new FakeSigner();
  return {
    api,
    signer,
    value: new AgentCoreBrowserSessionManager(api, signer, "aws.browser.v1"),
  };
}

describe("AgentCoreBrowserSessionManager", () => {
  it("starts a profiled session with stable idempotency and returns only ephemeral signed connection data", async () => {
    const { value, api, signer } = manager();

    const first = await value.start(scope, request);
    const second = await value.start(scope, request);

    expect(first.sessionId).toBe("session123");
    expect(first.connection).toEqual(signer.connection);
    expect(api.starts[0]?.profileIdentifier).toBe(profileId);
    expect(api.starts[0]?.viewport).toEqual({ width: 1_440, height: 900 });
    expect(api.starts[0]?.clientToken).toBe(api.starts[1]?.clientToken);
    expect(api.starts[0]?.clientToken.length).toBeGreaterThanOrEqual(33);
    expect(api.starts[0]?.name).not.toContain(scope.tenantId);
    expect(api.starts[0]?.name).not.toContain(scope.userId);
    expect(JSON.stringify(api.starts[0])).not.toContain("authorization");
    expect(signer.calls).toHaveLength(2);
    expect(second.connection.headers.authorization).toBe("signed");
  });

  it("stops a newly-created session if signing the automation connection fails", async () => {
    const { value, api, signer } = manager();
    signer.error = new Error("signing failed");

    await expect(value.start(scope, request)).rejects.toThrow(/signing failed/);
    expect(api.stops).toEqual([
      { browserIdentifier: "aws.browser.v1", sessionId: "session123" },
    ]);
  });

  it("rejects service-invalid timeouts before creating cloud resources", async () => {
    const { value, api } = manager();

    await expect(
      value.start(scope, { ...request, timeoutSeconds: 28_801 }),
    ).rejects.toThrow(/between 1 and 28800/);
    expect(api.starts).toHaveLength(0);
  });

  it("saves a live session into the exact validated browser profile with an idempotency token", async () => {
    const { value, api } = manager();
    const session: BrowserSessionHandle = {
      sessionId: "session123",
      connection: { endpoint: "wss://example", headers: {} },
    };

    await value.saveProfile(scope, session, profileRef(profileId));
    await value.saveProfile(scope, session, profileRef(profileId));

    expect(api.saves[0]?.profileIdentifier).toBe(profileId);
    expect(api.saves[0]?.clientToken).toBe(api.saves[1]?.clientToken);
    expect(api.saves[0]?.clientToken.length).toBeGreaterThanOrEqual(33);
  });

  it("treats stopping an already-missing session as idempotent but preserves other AWS errors", async () => {
    const { value, api } = manager();
    const session: BrowserSessionHandle = {
      sessionId: "session123",
      connection: { endpoint: "wss://example", headers: {} },
    };

    api.stopError = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    await expect(value.stop(scope, session)).resolves.toBeUndefined();

    api.stopError = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    await expect(value.stop(scope, session)).rejects.toThrow(/denied/);
  });

  it("rejects invalid session identifiers before save or stop calls", async () => {
    const { value, api } = manager();
    const invalid: BrowserSessionHandle = {
      sessionId: "bad/session",
      connection: { endpoint: "wss://example", headers: {} },
    };

    await expect(value.saveProfile(scope, invalid, profileRef(profileId))).rejects.toThrow(/invalid browser session/);
    await expect(value.stop(scope, invalid)).rejects.toThrow(/invalid browser session/);
    expect(api.saves).toHaveLength(0);
    expect(api.stops).toHaveLength(0);
  });
});
