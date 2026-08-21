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

function request(controlStates = [{ phase: "WORKFLOW" as const, finishRequested: true }]): CaptureCollectionSourceRequest {
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

  it("observes Live View input without retaining the typed value", async () => {
    let binding: ((source: unknown, payload: unknown) => Promise<void>) | undefined;
    const page = {
      evaluate: vi.fn(async () => {
        await binding?.({}, {
          kind: "INPUT",
          page: { url: "https://example.com/app", title: "App" },
          target: { testId: "note", css: "textarea" },
          inputType: "textarea",
          value: "must-never-be-captured",
        });
      }),
      on: vi.fn(),
      mainFrame: vi.fn(),
      title: vi.fn(async () => "App"),
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
      purpose: "AUTH_SETUP",
      page: { url: "https://example.com/app" },
      input: { kind: "RUNTIME_VARIABLE", sensitive: true },
    });
    expect(JSON.stringify(events)).not.toContain("must-never-be-captured");
  });

  it("rejects invalid polling configuration before connecting to browser compute", () => {
    expect(() => new AgentCorePlaywrightCaptureEventSource(signer(), "aws.browser.v1", { controlPollMs: 0 })).toThrow(/poll interval/);
    expect(playwright.connectOverCDP).not.toHaveBeenCalled();
  });
});
