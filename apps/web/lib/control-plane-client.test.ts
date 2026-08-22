import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, readWebControlPlaneConfig, type FetchLike } from "./control-plane-client.js";

describe("WebControlPlaneClient", () => {
  it("returns an explicit NOT_CONFIGURED dashboard without making a network request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const client = new WebControlPlaneClient({}, fetchImpl);

    const dashboard = await client.dashboard();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dashboard.automations).toEqual([]);
    expect(dashboard.capabilities).toEqual({
      auth: "NOT_CONFIGURED",
      capture: "NOT_CONFIGURED",
      cloudExecution: "NOT_CONFIGURED",
      scheduling: "NOT_CONFIGURED",
      notifications: "NOT_CONFIGURED",
    });
  });

  it("does not load a static control-plane token from deployment environment", () => {
    expect(readWebControlPlaneConfig({
      AUTOMATION_CONTROL_PLANE_URL: "https://control.example.test",
      AUTOMATION_CONTROL_PLANE_BEARER_TOKEN: "legacy-token",
    })).toEqual({ baseUrl: "https://control.example.test" });
  });

  it("keeps a request-scoped bearer token server-side and encodes automation ids", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-scoped-token" },
      fetchImpl,
    );

    await client.runs("customer/demo");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://control.example.test/v1/automations/customer%2Fdemo/runs");
    expect(init?.headers).toMatchObject({ authorization: "Bearer request-scoped-token" });
  });

  it("routes BYOK management through the authenticated control plane", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/credentials")) {
        return new Response(JSON.stringify({ credentials: [] }), { status: 200 });
      }
      if (url.endsWith("/rotate")) {
        return new Response(JSON.stringify({
          credentialId: "customer/key",
          provider: "openai",
          maskedLabel: "OpenAI",
          status: "UNKNOWN",
          priority: 0,
          failureCount: 0,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ removed: true }), { status: 200 });
    });
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await expect(client.credentials()).resolves.toEqual([]);
    await client.rotateCredential("customer/key", "replacement-secret");
    await expect(client.removeCredential("customer/key")).resolves.toEqual({ removed: true });

    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://control.example.test/v1/credentials/customer%2Fkey/rotate",
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      "https://control.example.test/v1/credentials/customer%2Fkey/remove",
    );
    const rotateInit = fetchImpl.mock.calls[1]?.[1];
    expect(rotateInit?.headers).toMatchObject({ authorization: "Bearer request-token" });
    expect(rotateInit?.body).toBe(JSON.stringify({ apiKey: "replacement-secret" }));
  });

  it("routes capture recording state and commands through authenticated server requests", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => new Response(JSON.stringify(
      String(input).endsWith("/cancel")
        ? { kind: "CANCELED", cleanupPending: true }
        : {
            kind: "ACTIVE",
            captureSessionId: "capture-1",
            phase: "WORKFLOW",
            finishRequested: false,
            expiresAt: "2026-08-21T10:00:00.000Z",
          },
    ), { status: 200 }));
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await client.captureRecording("customer/demo");
    await client.startCaptureRecording("customer/demo", "capture-1");
    await client.finishCaptureRecording("customer/demo", "capture-1");
    await expect(client.cancelCaptureRecording("customer/demo")).resolves.toEqual({ kind: "CANCELED", cleanupPending: true });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-recording",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-recording/start",
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ captureSessionId: "capture-1" }));
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-recording/finish",
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-recording/cancel",
    );
    expect(fetchImpl.mock.calls[3]?.[1]?.body).toBe("{}");
  });

  it("routes schedule lifecycle commands through the authenticated control plane", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ status: "PAUSED" }), { status: 200 }));
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await client.command("customer/demo", "schedule", {
      schedule: { kind: "DAILY", expression: "08:30", timezone: "Asia/Kolkata" },
    });
    await client.command("customer/demo", "pause", {});

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/schedule",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      schedule: { kind: "DAILY", expression: "08:30", timezone: "Asia/Kolkata" },
    }));
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/pause",
    );
  });

  it("does not surface remote error bodies", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ error: { message: "upstream-private-detail" } }), { status: 500 }),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "token" },
      fetchImpl,
    );

    await expect(client.automation("demo")).rejects.toThrow("Control-plane request failed");
  });

  it("rejects insecure non-local control-plane URLs", () => {
    const client = new WebControlPlaneClient({ baseUrl: "http://example.com", bearerToken: "token" });
    expect(client.status()).toEqual({ configured: false, reason: "INVALID_BASE_URL" });
  });
});
