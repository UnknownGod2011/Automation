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
  name: "Capture submit normalization",
  websiteUrl: "https://example.com/",
  prompt: "Submit one form",
  status: "CAPTURING",
  browserProfileRef: "profile-a",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

function request(onFirstPoll?: () => Promise<void> | void): CaptureCollectionSourceRequest {
  let reads = 0;
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
      startedAt: "2026-08-26T00:00:00.000Z",
      expiresAt: "2026-08-26T01:00:00.000Z",
      status: "STARTED",
    },
    control: {
      markReady: async () => "UPDATED" as const,
      getState: async () => {
        if (reads === 1) await onFirstPoll?.();
        return {
          phase: "WORKFLOW" as const,
          finishRequested: reads++ > 0,
          collectorReady: true,
        };
      },
    },
  };
}

function signer(): AgentCoreBrowserConnectionSigner {
  return {
    sign: async () => ({
      endpoint: "wss://example.invalid/cdp",
      headers: { authorization: "signed" },
    }),
  };
}

type NavigationFrame = { url: () => string };
type NavigationHandler = (frame: NavigationFrame) => void;

describe("capture submit normalization", () => {
  beforeEach(() => playwright.connectOverCDP.mockReset());

  it("coalesces navigation that reaches Node before the initiating click/submit binding", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
    let navigationHandler: NavigationHandler | undefined;
    let releaseEffect: (() => void) | undefined;
    const effectSettled = new Promise<void>((resolve) => { releaseEffect = resolve; });
    const mainFrame: NavigationFrame = { url: () => "https://example.com/form/complete" };
    const page = {
      evaluate: vi.fn(async (script: unknown) => {
        if (typeof script === "string") return undefined;
        return [
          { tag: "div", testId: "complete" },
          { tag: "main", id: "result" },
        ];
      }),
      on: vi.fn((event: string, callback: NavigationHandler) => {
        if (event === "framenavigated") navigationHandler = callback;
      }),
      mainFrame: vi.fn(() => mainFrame),
      title: vi.fn(async () => "Complete"),
      url: vi.fn(() => "https://example.com/form/complete"),
      waitForTimeout: vi.fn(async () => effectSettled),
      screenshot: vi.fn(),
    };
    const context = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      on: vi.fn(),
    };
    playwright.connectOverCDP.mockResolvedValue({ contexts: () => [context] });

    let navigationDelivered = false;
    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      now: () => new Date("2026-08-26T00:01:00.000Z"),
      controlPollMs: 1,
      effectSettleMs: 1,
    });
    const eventsPromise = source.collect(request(async () => {
      navigationDelivered = true;
      navigationHandler?.(mainFrame);
      const click = binding?.({ page }, {
        kind: "CLICK",
        page: { url: "https://example.com/form", title: "Form" },
        target: { role: "button", accessibleName: "Save", testId: "save", css: "button" },
      });
      const submit = binding?.({ page }, {
        kind: "SUBMIT",
        page: { url: "https://example.com/form", title: "Form" },
        target: { role: "button", accessibleName: "Save", testId: "save", css: "button" },
      });
      await Promise.all([click, submit]);
      releaseEffect?.();
    }));
    const events = await eventsPromise;

    expect(navigationDelivered).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sequence: 1,
      kind: "SUBMIT",
      purpose: "WORKFLOW",
      page: { url: "https://example.com/form" },
      target: { testId: "save", role: "button", accessibleName: "Save" },
      expectedEffect: { mode: "CUSTOM" },
    });
    expect(events[0]?.expectedEffect?.expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(events.some((event) => event.kind === "CLICK")).toBe(false);
    expect(events.some((event) => event.kind === "NAVIGATION")).toBe(false);
  });

  it("still records genuinely independent main-frame navigation after the bounded grace", async () => {
    let navigationHandler: NavigationHandler | undefined;
    const mainFrame: NavigationFrame = { url: () => "https://example.com/independent" };
    const page = {
      evaluate: vi.fn(async () => undefined),
      on: vi.fn((event: string, callback: NavigationHandler) => {
        if (event === "framenavigated") navigationHandler = callback;
      }),
      mainFrame: vi.fn(() => mainFrame),
      title: vi.fn(async () => "Independent"),
      url: vi.fn(() => "https://example.com/independent"),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot: vi.fn(),
    };
    const context = {
      exposeBinding: vi.fn(async () => undefined),
      addInitScript: vi.fn(async () => undefined),
      pages: vi.fn(() => [page]),
      on: vi.fn(),
    };
    playwright.connectOverCDP.mockResolvedValue({ contexts: () => [context] });

    const source = new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", {
      now: () => new Date("2026-08-26T00:01:00.000Z"),
      controlPollMs: 1,
      effectSettleMs: 1,
    });
    const events = await source.collect(request(() => {
      navigationHandler?.(mainFrame);
    }));

    expect(events).toEqual([
      expect.objectContaining({
        sequence: 1,
        kind: "NAVIGATION",
        purpose: "WORKFLOW",
        page: { url: "https://example.com/independent", title: "Independent" },
        navigationUrl: "https://example.com/independent",
      }),
    ]);
  });
});
