import { describe, expect, it, vi } from "vitest";
import { WebControlPlaneClient, WebControlPlaneError, type FetchLike } from "./control-plane-client.js";

describe("WebControlPlaneClient capture evidence", () => {
  it("routes owner-authenticated capture evidence reads without exposing storage identity", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      if (url.endsWith("/capture-evidence")) {
        return new Response(JSON.stringify({
          kind: "READY",
          completedAt: "2026-08-25T12:01:00.000Z",
          totalScreenshotCount: 1,
          truncated: false,
          items: [{ ordinal: 1, action: "CLICK", occurredAt: "2026-08-25T12:00:30.000Z", origin: "https://example.test" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        kind: "SCREENSHOT",
        ordinal: 1,
        action: "CLICK",
        occurredAt: "2026-08-25T12:00:30.000Z",
        origin: "https://example.test",
        contentType: "image/png",
        sizeBytes: 11,
        dataBase64: "iVBORw0KGgoBAgM=",
      }), { status: 200 });
    });
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    const index = await client.captureEvidence("customer/demo");
    const screenshot = await client.captureEvidenceItem("customer/demo", 1);

    expect(index).toEqual(expect.objectContaining({ kind: "READY", totalScreenshotCount: 1 }));
    expect(screenshot).toEqual(expect.objectContaining({ kind: "SCREENSHOT", ordinal: 1 }));
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-evidence",
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture-evidence/1",
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer request-token" });
    expect(JSON.stringify(index)).not.toContain("artifactRef");
    expect(JSON.stringify(index)).not.toContain("traceId");
  });

  it("rejects invalid capture evidence ordinals before any request", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    await expect(client.captureEvidenceItem("demo", 0)).rejects.toBeInstanceOf(WebControlPlaneError);
    await expect(client.captureEvidenceItem("demo", 201)).rejects.toBeInstanceOf(WebControlPlaneError);
    await expect(client.captureEvidenceItem("demo", 1.5)).rejects.toBeInstanceOf(WebControlPlaneError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
