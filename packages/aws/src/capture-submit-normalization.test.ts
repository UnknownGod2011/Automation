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

function request(): CaptureCollectionSourceRequest {
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
      getState: async () => ({
        phase: "WORKFLOW" as const,
        finishRequested: reads++ > 0,
      }),
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

describe("capture submit normalization", () => {
  beforeEach(() => playwright.connectOverCDP.mockReset());

  it("coalesces the initiating click and native submit into one verified SUBMIT event", async () => {
    let binding: ((source: { page: unknown }, payload: unknown) => Promise<void>) | undefined;
    const page = {
      evaluate: vi.fn(async (script: unknown) => {
        if (typeof script === "string") {
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
          return undefined;
        }
        return [
          { tag: "button", testId: "save", ariaDisabled: "true" },
          { tag: "form", id: "editor" },
        ];
      }),
      on: vi.fn(),
      mainFrame: vi.fn(),
      title: vi.fn(async () => "Form"),
      url: vi.fn(() => "https://example.com/form"),
      waitForTimeout: vi.fn(async () => undefined),
      screenshot: vi.fn(),
    };
    const context = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
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
    const events = await source.collect(request());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sequence: 1,
      kind: "SUBMIT",
      purpose: "WORKFLOW",
      target: { testId: "save", role: "button", accessibleName: "Save" },
      expectedEffect: {
        mode: "CUSTOM",
      },
    });
    expect(events[0]?.expectedEffect?.expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(events.some((event) => event.kind === "CLICK")).toBe(false);
  });
});
