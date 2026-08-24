import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import type { CaptureCollectionSourceRequest } from "@automation/core";
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
  { phase: "WORKFLOW" as const, finishRequested: false },
  { phase: "WORKFLOW" as const, finishRequested: true },
]): CaptureCollectionSourceRequest {
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
    },
  };
}

function signer(): AgentCoreBrowserConnectionSigner {
  return {
    sign: async () => ({ endpoint: "wss://example.invalid/cdp", headers: { authorization: "signed" } }),
  };
}

describe("AgentCorePlaywrightCaptureEventSource", () => {
  beforeEach(() => playwright.connectOverCDP.mockReset());

  it("starts in durable WORKFLOW phase and observes input without retaining the typed value", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
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
    });
    const events = await source.collect(request());

    expect(playwright.connectOverCDP).toHaveBeenCalledWith("wss://example.invalid/cdp", {
      headers: { authorization: "signed" },
      timeout: 30_000,
    });
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
    });
    expect(JSON.stringify(events)).not.toContain("must-never-be-captured");
  });

  it("records a redacted post-action structural digest for click verification", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
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
    });
    const events = await source.collect(request());

    expect(events).toHaveLength(1);
    const expected = events[0]?.expectedEffect?.expected;
    expect(events[0]?.expectedEffect?.mode).toBe("CUSTOM");
    expect(expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(expected).not.toContain("private=query");
    expect(expected).not.toContain("Private customer name");
    expect(expected).not.toContain("Save private note");
  });

  it("does not allocate automation-stream work if finish was already durable", async () => {
    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      controlPollMs: 1,
    });
    await expect(source.collect(request([{ phase: "WORKFLOW", finishRequested: true }]))).resolves.toEqual([]);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });

  it("rejects collection before the workflow phase without connecting", async () => {
    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      controlPollMs: 1,
    });
    await expect(source.collect(request([{ phase: "AUTH_SETUP", finishRequested: false }])))
      .rejects.toThrow("requires WORKFLOW phase");
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });

  it("rejects invalid polling and effect-settle configuration before connecting to browser compute", () => {
    expect(() => new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", { controlPollMs: 0 })).toThrow(/poll interval/);
    expect(() => new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", { effectSettleMs: 0 })).toThrow(/effect settle interval/);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });
});
