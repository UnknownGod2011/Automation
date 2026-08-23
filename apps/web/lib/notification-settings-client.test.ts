import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, type FetchLike } from "./control-plane-client.js";

describe("notification settings client", () => {
  it("routes preference updates through the authenticated automation boundary", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      automationId: "customer/demo",
      name: "Demo",
      websiteUrl: "https://example.test",
      objective: "Run demo",
      status: "ACTIVE",
      notifyOnSuccess: true,
      notifyOnFailure: false,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T01:00:00.000Z",
      needsAttention: false,
    }), { status: 200 }));
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-scoped-token" },
      fetchImpl,
    );

    const result = await client.updateNotificationPreferences("customer/demo", {
      notifyOnSuccess: true,
      notifyOnFailure: false,
    });

    expect(result.notifyOnSuccess).toBe(true);
    expect(result.notifyOnFailure).toBe(false);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/notifications",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer request-scoped-token",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      notifyOnSuccess: true,
      notifyOnFailure: false,
    }));
  });
});
