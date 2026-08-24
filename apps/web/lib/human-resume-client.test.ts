import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, type FetchLike } from "./control-plane-client.js";

describe("human resume web client", () => {
  it("sends only the paused node through the authenticated control plane", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      kind: "RESUMED",
      runId: "run/customer 1",
      status: "SUCCEEDED",
    }), { status: 200 }));
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-scoped-token" },
      fetchImpl,
    );

    await expect(client.resumeRun(
      "customer/demo",
      "run/customer 1",
      "human approve",
    )).resolves.toEqual({ kind: "RESUMED", runId: "run/customer 1", status: "SUCCEEDED" });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/runs/run%2Fcustomer%201/resume",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer request-scoped-token",
      },
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      expectedNodeId: "human approve",
    });
  });
});
