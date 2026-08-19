import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient } from "./control-plane-client.js";

describe("WebControlPlaneClient", () => {
  it("returns an explicit NOT_CONFIGURED dashboard without making a network request", async () => {
    const fetchImpl = vi.fn();
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

  it("keeps the bearer token server-side and encodes automation ids", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "server-secret-token" },
      fetchImpl,
    );

    await client.runs("customer/demo");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://control.example.test/v1/automations/customer%2Fdemo/runs");
    expect(init?.headers).toMatchObject({ authorization: "Bearer server-secret-token" });
  });

  it("does not surface remote error bodies", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "provider secret: abc123" } }), { status: 500 }),
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
