import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import type { ArtifactStore, CaptureCollectionSourceRequest } from "@automation/core";
import { AgentCorePlaywrightCaptureEventSource } from "./capture-collector.js";
import type { AgentCoreBrowserConnectionSigner } from "./browser-session.js";

const playwright = vi.hoisted(() => ({ connectOverCDP: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { connectOverCDP: playwright.connectOverCDP } }));

const scope = { tenantId: "tenant-a", userId: "user-a" };
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "automation-a",
  name: "Capture",
  websiteUrl: "https://example.com/",
  prompt: "Save a note",
  status: "CAPTURING",
  browserProfileRef: "profile-a",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function request(controlStates = [
  { phase: "WORKFLOW" as const, finishRequested: false, collectorReady: false },
  { phase: "WORKFLOW" as const, finishRequested: true, collectorReady: true },
], markReady = vi.fn(async () => "UPDATED" as const)): CaptureCollectionSourceRequest {
  let index = 0;
  return {
    scope,
    automation,
    session: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: automation.automationId,
      captureSessionId: "capture-a",
      browserSessionId: "browser-a",
      browserProfileRef: "profile-a",
      startedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2026-08-21T01:00:00.000Z",
      status: "STARTED",
    },
    control: {
      getState: async () => controlStates[Math.min(index++, controlStates.length - 1)]!,
      markReady,
    },
  };
}

function signer(): AgentCoreBrowserConnectionSigner {
  return {
    sign: async () => ({ endpoint: "wss://example.invalid/cdp", headers: { authorization: "signed" } }),
  };
}

function artifactStore(put = vi.fn<ArtifactStore["put"]>(async (_scope, _path, content, contentType) => ({
  ref: "aws-s3-artifact://capture-screenshot",
  contentType,
  sizeBytes: content.byteLength,
}))): ArtifactStore {
  return {
    put,
    get: vi.fn(async () => null),
  };
}

describe("AgentCorePlaywrightCaptureEventSource", () => {
  beforeEach(() => playwright.connectOverCDP.mockReset());

  it("starts in durable WORKFLOW phase, marks readiness after instrumentation, and observes input without retaining or screenshotting the typed value", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
    const screenshot = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
    const artifacts = artifactStore();
    const markReady = vi.fn(async () => "UPDATED" as const);
    const page = {
      evaluate: vi.fn(async (script: unknown) => {
        if (typeof script === "string") {
          await binding?.({ page }, {
            kind: "INPUT",
            page: { url: "https://example.com/app", title: "App" },
            target: { testId: "note", css: "textarea" },
            inputType: "textarea",
            value: "must-never-be-captured",
          });
        }
        return [];
      }),
      on: vi.fn(),
      mainFrame: vi.fn(),
      title: vi.fn(async () => "App"),
      url: vi.fn(() => "https://example.com/app?private=1"),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot,
    };
    const context = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      on: vi.fn(),
    };
    playwright.connectOverCDP.mockResolvedValue({ contexts: () => [context] });

    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      now: () => new Date("2026-08-21T00:01:00.000Z"),
      controlPollMs: 1,
      artifacts,
    });
    const events = await source.collect(request(undefined, markReady));

    expect(playwright.connectOverCDP).toHaveBeenCalledWith("wss://example.invalid/cdp", {
      headers: { authorization: "signed" },
      timeout: 30_000,
    });
    expect(context.exposeBinding).toHaveBeenCalledOnce();
    expect(context.addInitScript).toHaveBeenCalledOnce();
    expect(page.evaluate).toHaveBeenCalled();
    expect(context.on).toHaveBeenCalledWith("page", expect.any(Function));
    expect(markReady).toHaveBeenCalledWith(scope, "capture-a", "2026-08-21T00:01:00.000Z");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "INPUT",
      purpose: "WORKFLOW",
      page: { url: "https://example.com/app" },
      input: { kind: "RUNTIME_VARIABLE", sensitive: true },
      expectedEffect: {
        mode: "CUSTOM",
        expected: "capture:input-filled",
      },
      artifactRefs: [],
    });
    expect(JSON.stringify(events)).not.toContain("must-never-be-captured");
    expect(screenshot).not.toHaveBeenCalled();
    expect(artifacts.put).not.toHaveBeenCalled();
  });

  it("records redacted structural verification plus a bounded post-action screenshot for clicks", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
    const screenshotBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const screenshot = vi.fn(async () => screenshotBytes);
    const put = vi.fn<ArtifactStore["put"]>(async (_scope, _path, content, contentType) => ({
      ref: "aws-s3-artifact://capture-screenshot",
      contentType,
      sizeBytes: content.byteLength,
    }));
    const artifacts = artifactStore(put);
    const page = {
      evaluate: vi.fn(async (script: unknown) => {
        if (typeof script === "string") {
          await binding?.({ page }, {
            kind: "CLICK",
            page: { url: "https://example.com/app?private=query", title: "Private customer name" },
            target: { testId: "save", role: "button", text: "Save private note", css: "button" },
          });
          return undefined;
        }
        return [
          { tag: "button", testId: "save", ariaDisabled: "true" },
          { tag: "form", id: "editor" },
        ];
      }),
      on: vi.fn(),
      mainFrame: vi.fn(),
      title: vi.fn(async () => "Private customer name"),
      url: vi.fn(() => "https://example.com/app?private=query#secret"),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot,
    };
    const context = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      on: vi.fn(),
    };
    playwright.connectOverCDP.mockResolvedValue({ contexts: () => [context] });

    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      now: () => new Date("2026-08-21T00:01:00.000Z"),
      controlPollMs: 1,
      effectSettleMs: 1,
      artifacts,
    });
    const events = await source.collect(request());

    expect(events).toHaveLength(1);
    const expected = events[0]?.expectedEffect?.expected;
    expect(events[0]?.expectedEffect?.mode).toBe("CUSTOM");
    expect(expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(expected).not.toContain("private=query");
    expect(expected).not.toContain("Private customer name");
    expect(expected).not.toContain("Save private note");
    expect(events[0]?.artifactRefs).toEqual([{
      ref: "aws-s3-artifact://capture-screenshot",
      kind: "SCREENSHOT",
      contentType: "image/png",
    }]);
    expect(screenshot).toHaveBeenCalledWith({ type: "png", fullPage: false });
    expect(put).toHaveBeenCalledWith(
      scope,
      "capture/capture-a/event-1.png",
      screenshotBytes,
      "image/png",
    );
  });

  it("keeps post-action screenshot failures supplementary instead of weakening verification", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
    const artifacts = artifactStore(vi.fn<ArtifactStore["put"]>(async () => { throw new Error("s3 unavailable"); }));
    const page = {
      evaluate: vi.fn(async (script: unknown) => {
        if (typeof script === "string") {
          await binding?.({ page }, {
            kind: "SUBMIT",
            page: { url: "https://example.com/app", title: "App" },
            target: { css: "form" },
          });
          return undefined;
        }
        return [{ tag: "form", id: "editor" }];
      }),
      on: vi.fn(),
      mainFrame: vi.fn(),
      title: vi.fn(async () => "App"),
      url: vi.fn(() => "https://example.com/app"),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => new Uint8Array([137, 80, 78, 71, 1])),
    };
    const context = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      on: vi.fn(),
    };
    playwright.connectOverCDP.mockResolvedValue({ contexts: () => [context] });

    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      now: () => new Date("2026-08-21T00:01:00.000Z"),
      controlPollMs: 1,
      effectSettleMs: 1,
      artifacts,
    });
    const events = await source.collect(request());

    expect(events[0]?.kind).toBe("SUBMIT");
    expect(events[0]?.expectedEffect?.expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(events[0]?.artifactRefs).toEqual([]);
  });

  it("does not allocate automation-stream work if finish was already durable", async () => {
    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      controlPollMs: 1,
    });
    await expect(source.collect(request([{ phase: "WORKFLOW", finishRequested: true, collectorReady: false }])))
      .resolves.toEqual([]);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });

  it("rejects collection before the workflow phase without connecting", async () => {
    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      controlPollMs: 1,
    });
    await expect(source.collect(request([{ phase: "AUTH_SETUP", finishRequested: false, collectorReady: false }])))
      .rejects.toThrow("requires WORKFLOW phase");
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });

  it("rejects invalid polling and effect-settle configuration before connecting to browser compute", () => {
    expect(() => new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", { controlPollMs: 0 })).toThrow(/poll interval/);
    expect(() => new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", { effectSettleMs: 0 })).toThrow(/effect settle interval/);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });
});
