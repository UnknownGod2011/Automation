import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, type FetchLike } from "./control-plane-client.js";

describe("human takeover web client", () => {
  it("starts and finishes repair without exposing browser/profile identifiers in request JSON", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith("/start")
        ? { kind: "READY", liveViewUrl: "https://repair.example.test/live", expiresAt: "2026-08-21T01:00:00.000Z" }
        : { kind: "RESUMED", runId: "run/customer 1", status: "SUCCEEDED" }), { status: 200 });
    });
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-scoped-token" },
      fetchImpl,
    );

    await client.startHumanTakeover("customer/demo", "run/customer 1");
    await client.finishHumanTakeover("customer/demo", "run/customer 1");

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://control.example.test/v1/automations/customer%2Fdemo/runs/run%2Fcustomer%201/takeover/start");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://control.example.test/v1/automations/customer%2Fdemo/runs/run%2Fcustomer%201/takeover/finish");
    expect(fetchImpl.mock.calls.map((call) => call[1]?.body)).toEqual(["{}", "{}"]);
  });
});
