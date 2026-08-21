import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, type FetchLike } from "./control-plane-client.js";

describe("run detail web client", () => {
  it("routes both automation and run identities through the authenticated control plane", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      runId: "run/customer 1",
      automationId: "customer/demo",
      workflowVersion: 2,
      status: "WAITING_FOR_HUMAN",
      scheduledAt: "2026-08-21T08:00:00.000Z",
      needsHumanAttention: true,
    }), { status: 200 }));
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-scoped-token" },
      fetchImpl,
    );

    await expect(client.run("customer/demo", "run/customer 1")).resolves.toMatchObject({
      status: "WAITING_FOR_HUMAN",
      needsHumanAttention: true,
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/runs/run%2Fcustomer%201",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer request-scoped-token",
    });
  });
});
