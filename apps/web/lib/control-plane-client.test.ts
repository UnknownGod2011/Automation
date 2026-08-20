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
