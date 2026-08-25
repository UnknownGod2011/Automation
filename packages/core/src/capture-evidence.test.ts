import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, CaptureTrace } from "@automation/contracts";
import {
  InMemoryArtifactStore,
  InMemoryAutomationRepository,
} from "./memory.js";
import {
  InMemoryCaptureSessionStore,
  type CaptureSessionRecord,
} from "./capture-completion.js";
import { InMemoryCaptureTraceRepository } from "./product-lifecycle.js";
import {
  CaptureEvidenceControlPlaneHttpHandler,
  CaptureEvidenceService,
} from "./capture-evidence.js";
import type { ArtifactStore, OwnershipScope } from "./index.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };
const profileRef = "profile://tenant-1/user-1/auto-1";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Update note",
    websiteUrl: "https://example.test/app",
    prompt: "Update the account note",
    status: "READY_TO_TEST",
    browserProfileRef: profileRef,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:05:00.000Z",
  };
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const sessions = new InMemoryCaptureSessionStore();
  const captures = new InMemoryCaptureTraceRepository();
  const artifacts = new InMemoryArtifactStore();
  await automations.put(automation());

  const clickScreenshot = await artifacts.put(owner, "capture/click.png", png, "image/png");
  const inputScreenshot = await artifacts.put(owner, "capture/input-should-stay-hidden.png", png, "image/png");
  const authScreenshot = await artifacts.put(owner, "capture/auth-should-stay-hidden.png", png, "image/png");
  const submitScreenshot = await artifacts.put(owner, "capture/submit.png", png, "image/png");

  const trace: CaptureTrace = {
    schemaVersion: 1,
    traceId: "trace-1",
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    websiteUrl: "https://example.test/app",
    objective: "Update the account note",
    browserProfileRef: profileRef,
    startedAt: "2026-08-25T12:00:00.000Z",
    finishedAt: "2026-08-25T12:01:00.000Z",
    events: [
      {
        eventId: "click-1",
        sequence: 1,
        kind: "CLICK",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-25T12:00:10.000Z",
        page: { url: "https://example.test/app?account=secret#private" },
        target: { role: "button", accessibleName: "Edit" },
        artifactRefs: [{ ref: clickScreenshot.ref, kind: "SCREENSHOT", contentType: "image/png" }],
      },
      {
        eventId: "input-2",
        sequence: 2,
        kind: "INPUT",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-25T12:00:20.000Z",
        page: { url: "https://example.test/app" },
        target: { role: "textbox", accessibleName: "Note" },
        input: { kind: "RUNTIME_VARIABLE", variableName: "capture_input_2", sensitive: true },
        artifactRefs: [{ ref: inputScreenshot.ref, kind: "SCREENSHOT", contentType: "image/png" }],
      },
      {
        eventId: "auth-3",
        sequence: 3,
        kind: "SUBMIT",
        purpose: "AUTH_SETUP",
        occurredAt: "2026-08-25T12:00:30.000Z",
        page: { url: "https://login.example.test/verify" },
        target: { role: "button", accessibleName: "Verify" },
        artifactRefs: [{ ref: authScreenshot.ref, kind: "SCREENSHOT", contentType: "image/png" }],
      },
      {
        eventId: "submit-4",
        sequence: 4,
        kind: "SUBMIT",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-25T12:00:40.000Z",
        page: { url: "https://example.test/app/complete?token=hidden" },
        target: { role: "button", accessibleName: "Save" },
        artifactRefs: [{ ref: submitScreenshot.ref, kind: "SCREENSHOT", contentType: "image/png" }],
      },
    ],
  };
  await captures.putImmutable(trace);

  const started: CaptureSessionRecord = {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    captureSessionId: "capture-1",
    browserSessionId: "browser-secret-id",
    browserProfileRef: profileRef,
    startedAt: "2026-08-25T12:00:00.000Z",
    expiresAt: "2026-08-25T12:05:00.000Z",
    status: "STARTED",
  };
  await sessions.putStarted(started);
  await sessions.complete(owner, "capture-1", trace.traceId, "2026-08-25T12:01:01.000Z");

  return {
    automations,
    sessions,
    captures,
    artifacts,
    service: new CaptureEvidenceService(automations, sessions, captures, artifacts),
  };
}

describe("CaptureEvidenceService", () => {
  it("lists only workflow action screenshots and keeps durable artifact identity server-side", async () => {
    const { service } = await setup();

    const view = await service.list(owner, "auto-1");

    expect(view).toEqual({
      kind: "READY",
      completedAt: "2026-08-25T12:01:01.000Z",
      totalScreenshotCount: 2,
      truncated: false,
      items: [
        {
          ordinal: 1,
          action: "CLICK",
          occurredAt: "2026-08-25T12:00:10.000Z",
          origin: "https://example.test",
        },
        {
          ordinal: 2,
          action: "SUBMIT",
          occurredAt: "2026-08-25T12:00:40.000Z",
          origin: "https://example.test",
        },
      ],
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("memory://");
    expect(serialized).not.toContain("browser-secret-id");
    expect(serialized).not.toContain("account=secret");
    expect(serialized).not.toContain("token=hidden");
    expect(serialized).not.toContain("capture_input_2");
    expect(serialized).not.toContain("login.example.test");
  });

  it("previews a bounded owner-authenticated screenshot by ordinal", async () => {
    const { service } = await setup();

    const view = await service.get(owner, "auto-1", "1");

    expect(view).toEqual(expect.objectContaining({
      kind: "SCREENSHOT",
      ordinal: 1,
      action: "CLICK",
      origin: "https://example.test",
      contentType: "image/png",
      sizeBytes: png.byteLength,
    }));
    if (view.kind === "SCREENSHOT") {
      expect(view.dataBase64).toBe("iVBORw0KGgoBAgM=");
    }
    expect(JSON.stringify(view)).not.toContain("memory://");
  });

  it("keeps cross-tenant requests away from artifact storage", async () => {
    const { automations, sessions, captures } = await setup();
    const artifacts: ArtifactStore = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      get: vi.fn(async () => png),
    };
    const service = new CaptureEvidenceService(automations, sessions, captures, artifacts);

    await expect(service.get(attacker, "auto-1", "1")).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(artifacts.get).not.toHaveBeenCalled();
  });

  it("returns NONE before a trusted capture completion exists", async () => {
    const automations = new InMemoryAutomationRepository();
    await automations.put(automation());
    const service = new CaptureEvidenceService(
      automations,
      new InMemoryCaptureSessionStore(),
      new InMemoryCaptureTraceRepository(),
      new InMemoryArtifactStore(),
    );

    await expect(service.list(owner, "auto-1")).resolves.toEqual({ kind: "NONE" });
  });

  it("fails closed when a completed capture pointer cannot resolve its immutable trace", async () => {
    const automations = new InMemoryAutomationRepository();
    const sessions = new InMemoryCaptureSessionStore();
    await automations.put(automation());
    await sessions.putStarted({
      tenantId: owner.tenantId,
      userId: owner.userId,
      automationId: "auto-1",
      captureSessionId: "capture-missing-trace",
      browserSessionId: "browser-1",
      browserProfileRef: profileRef,
      startedAt: "2026-08-25T12:00:00.000Z",
      expiresAt: "2026-08-25T12:05:00.000Z",
      status: "STARTED",
    });
    await sessions.complete(owner, "capture-missing-trace", "trace-missing", "2026-08-25T12:01:00.000Z");
    const service = new CaptureEvidenceService(
      automations,
      sessions,
      new InMemoryCaptureTraceRepository(),
      new InMemoryArtifactStore(),
    );

    await expect(service.list(owner, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "CONFLICT" }),
    );
  });

  it("exposes a read-only authenticated route and delegates unrelated paths", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = {
      handle: vi.fn(async () => ({ status: 418, body: { delegated: true } })),
    };
    const handler = new CaptureEvidenceControlPlaneHttpHandler(base, service);

    const index = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/capture-evidence" },
      { scope: owner },
    );
    expect(index.status).toBe(200);
    expect(index.body).toEqual(expect.objectContaining({ kind: "READY", totalScreenshotCount: 2 }));

    const screenshot = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/capture-evidence/1" },
      { scope: owner },
    );
    expect(screenshot.status).toBe(200);
    expect(screenshot.body).toEqual(expect.objectContaining({ kind: "SCREENSHOT", ordinal: 1 }));

    const rejected = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/capture-evidence" },
      { scope: owner },
    );
    expect(rejected.status).toBe(404);

    const delegated = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1" },
      { scope: owner },
    );
    expect(delegated.status).toBe(418);
  });
});
