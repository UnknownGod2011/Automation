import { describe, expect, it, vi } from "vitest";
import {
  WebControlPlaneClient,
  type FetchLike,
  type WebCaptureStartResult,
} from "./control-plane-client.js";

type ReadyCaptureStart = Extract<WebCaptureStartResult, { kind: "READY" }>;
type ReadyCaptureIncludesSessionId = "captureSessionId" extends keyof ReadyCaptureStart ? true : false;

const READY_CAPTURE_INCLUDES_SESSION_ID: ReadyCaptureIncludesSessionId = false;

describe("browser-facing capture start contract", () => {
  it("exposes only the short-lived Live View capability and expiry", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({
        kind: "READY",
        liveViewUrl: "https://live.example.test/session?capability=short-lived",
        expiresAt: "2026-08-25T12:00:00.000Z",
      }), { status: 201 }),
    );
    const client = new WebControlPlaneClient(
      { baseUrl: "https://control.example.test", bearerToken: "request-token" },
      fetchImpl,
    );

    const result = await client.capture("customer/demo");

    expect(result).toEqual({
      kind: "READY",
      liveViewUrl: "https://live.example.test/session?capability=short-lived",
      expiresAt: "2026-08-25T12:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("captureSessionId");
    expect(READY_CAPTURE_INCLUDES_SESSION_ID).toBe(false);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://control.example.test/v1/automations/customer%2Fdemo/capture",
    );
  });
});
