import { describe, expect, it, vi } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import { createAwsCaptureCompletionLambdaHandler } from "./capture-completion-lambda.js";

const trace: CaptureTrace = {
  schemaVersion: 1,
  traceId: "trace-1",
  tenantId: "tenant-1",
  userId: "user-1",
  automationId: "auto-1",
  websiteUrl: "https://example.com/",
  objective: "Save the form",
  browserProfileRef: "profile-1",
  startedAt: "2026-08-20T00:00:00.000Z",
  finishedAt: "2026-08-20T00:05:00.000Z",
  events: [
    {
      eventId: "e1",
      sequence: 1,
      kind: "NAVIGATION",
      purpose: "WORKFLOW",
      occurredAt: "2026-08-20T00:01:00.000Z",
      page: { url: "https://example.com/" },
      navigationUrl: "https://example.com/",
      artifactRefs: [],
    },
  ],
};

function event(body: unknown) {
  return {
    version: "2.0",
    rawPath: "/capture/complete",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

describe("createAwsCaptureCompletionLambdaHandler", () => {
  it("derives trusted scope from the trace and deployment tenant", async () => {
    const handle = vi.fn(async () => ({
      status: 202,
      body: { traceId: "trace-1", replayed: false, cleanupPending: false },
    }));
    const result = createAwsCaptureCompletionLambdaHandler(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      { handle },
    );
    expect(result.kind).toBe("CONFIGURED");
    if (result.kind !== "CONFIGURED") return;

    const response = await result.handler(event({
      automationId: "auto-1",
      captureSessionId: "capture-1",
      trace,
    }));

    expect(response.statusCode).toBe(202);
    expect(handle).toHaveBeenCalledWith(
      { automationId: "auto-1", captureSessionId: "capture-1", trace },
      {
        scope: { tenantId: "tenant-1", userId: "user-1" },
        trustedCaptureWorker: true,
      },
    );
  });

  it("rejects a cross-tenant trace before trusted completion work", async () => {
    const handle = vi.fn(async () => ({ status: 202, body: {} }));
    const result = createAwsCaptureCompletionLambdaHandler(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      { handle },
    );
    if (result.kind !== "CONFIGURED") throw new Error("expected configured handler");

    const response = await result.handler(event({
      automationId: "auto-1",
      captureSessionId: "capture-1",
      trace: { ...trace, tenantId: "tenant-2" },
    }));

    expect(response.statusCode).toBe(403);
    expect(handle).not.toHaveBeenCalled();
    expect(response.body).not.toContain("tenant-2");
  });

  it("rejects malformed routes and bodies without calling completion", async () => {
    const handle = vi.fn(async () => ({ status: 202, body: {} }));
    const result = createAwsCaptureCompletionLambdaHandler(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      { handle },
    );
    if (result.kind !== "CONFIGURED") throw new Error("expected configured handler");

    await expect(result.handler({
      ...event({ automationId: "auto-1", captureSessionId: "capture-1", trace }),
      rawPath: "/automations",
    })).resolves.toMatchObject({ statusCode: 400, isBase64Encoded: false });
    await expect(result.handler({
      ...event({}),
      body: "{not-json",
    })).resolves.toMatchObject({ statusCode: 400, isBase64Encoded: false });
    expect(handle).not.toHaveBeenCalled();
  });

  it("fails closed when the deployment tenant is absent", () => {
    expect(createAwsCaptureCompletionLambdaHandler({}, { handle: vi.fn() })).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AUTOMATION_TENANT_ID"],
    });
  });

  it("sanitizes unexpected transport failures", async () => {
    const result = createAwsCaptureCompletionLambdaHandler(
      { AUTOMATION_TENANT_ID: "tenant-1" },
      { handle: async () => { throw new Error("secret provider detail"); } },
    );
    if (result.kind !== "CONFIGURED") throw new Error("expected configured handler");

    const response = await result.handler(event({
      automationId: "auto-1",
      captureSessionId: "capture-1",
      trace,
    }));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret provider detail");
  });
});
