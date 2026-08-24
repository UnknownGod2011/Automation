import { describe, expect, it, vi } from "vitest";
import { createAwsCaptureCompletionRuntimeEntrypoint } from "./capture-completion-runtime.js";

const requestEvent = {
  version: "2.0",
  rawPath: "/capture/complete",
  requestContext: { http: { method: "POST" } },
  body: JSON.stringify({
    automationId: "auto-1",
    captureSessionId: "capture-1",
    trace: {
      tenantId: "tenant-1",
      userId: "user-1",
    },
  }),
  isBase64Encoded: false,
};

describe("createAwsCaptureCompletionRuntimeEntrypoint", () => {
  it("memoizes bootstrap and routes only to the trusted completion handler", async () => {
    const captureHandle = vi.fn(async () => ({ status: 202, body: { accepted: true } }));
    const bootstrap = vi.fn(() => ({
      kind: "CONFIGURED" as const,
      captureCompletion: { handle: captureHandle },
    }));
    const runtime = createAwsCaptureCompletionRuntimeEntrypoint(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      bootstrap,
    );

    await expect(runtime.handler(requestEvent)).resolves.toMatchObject({ statusCode: 202 });
    await expect(runtime.handler(requestEvent)).resolves.toMatchObject({ statusCode: 202 });
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(captureHandle).toHaveBeenCalledTimes(2);
  });

  it("returns a fixed unconfigured response without invoking completion", async () => {
    const runtime = createAwsCaptureCompletionRuntimeEntrypoint(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      () => ({ kind: "NOT_CONFIGURED" }),
    );
    await expect(runtime.handler(requestEvent)).resolves.toMatchObject({
      statusCode: 503,
      isBase64Encoded: false,
    });
  });

  it("sanitizes bootstrap failures", async () => {
    const runtime = createAwsCaptureCompletionRuntimeEntrypoint(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      () => { throw new Error("secret bootstrap failure"); },
    );
    const response = await runtime.handler(requestEvent);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret bootstrap failure");
  });
});
