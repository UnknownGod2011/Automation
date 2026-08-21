import type { CaptureEvent, CaptureSemanticTarget } from "@automation/contracts";
import type {
  CaptureCollectionEventSource,
  CaptureCollectionSourceRequest,
} from "@automation/core";
import { chromium, type Page } from "playwright-core";
import type { AgentCoreBrowserConnectionSigner } from "./browser-session.js";

const DEFAULT_CONTROL_POLL_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const MAX_TARGET_FIELD_LENGTH = 512;

const CAPTURE_INSTALLER = `(() => {
  const key = "__automationCaptureInstalled";
  if (window[key]) return;
  window[key] = true;
  const clip = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : undefined;
  const target = (node) => {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element) return { css: "unknown" };
    const role = clip(element.getAttribute("role"));
    const accessibleName = clip(element.getAttribute("aria-label"));
    const testId = clip(element.getAttribute("data-testid") || element.getAttribute("data-test-id"));
    const text = clip(element.textContent, 256);
    const id = clip(element.id);
    const tag = element.tagName.toLowerCase();
    const css = id ? "#" + CSS.escape(id) : tag;
    return { role, accessibleName, testId, text, css };
  };
  const emit = (payload) => {
    const bridge = window.__automationCaptureEvent;
    if (typeof bridge === "function") void bridge({
      ...payload,
      page: { url: location.href, title: document.title },
    });
  };
  document.addEventListener("click", (event) => {
    emit({ kind: "CLICK", target: target(event.target) });
  }, true);
  document.addEventListener("change", (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
    emit({ kind: "INPUT", target: target(element), inputType: element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase() });
  }, true);
  document.addEventListener("submit", (event) => {
    emit({ kind: "SUBMIT", target: target(event.target) });
  }, true);
})()`;

interface BrowserCapturePayload {
  kind: "CLICK" | "INPUT" | "SUBMIT";
  page: { url: string; title?: string };
  target: CaptureSemanticTarget;
  inputType?: string;
}

export interface AgentCorePlaywrightCaptureEventSourceOptions {
  controlPollMs?: number;
  connectTimeoutMs?: number;
  now?: () => Date;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new Error(`${name} must be an integer between 1 and 60000 milliseconds`);
  }
  return value;
}

function safeString(value: unknown, max = MAX_TARGET_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeTarget(value: unknown): CaptureSemanticTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { css: "unknown" };
  const record = value as Record<string, unknown>;
  const role = safeString(record.role);
  const accessibleName = safeString(record.accessibleName);
  const text = safeString(record.text, 256);
  const testId = safeString(record.testId);
  const css = safeString(record.css);
  return {
    ...(role ? { role } : {}),
    ...(accessibleName ? { accessibleName } : {}),
    ...(text ? { text } : {}),
    ...(testId ? { testId } : {}),
    ...(css ? { css } : { css: "unknown" }),
  };
}

function isBrowserPayload(value: unknown): value is BrowserCapturePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "CLICK" || record.kind === "INPUT" || record.kind === "SUBMIT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AgentCorePlaywrightCaptureEventSource implements CaptureCollectionEventSource {
  private readonly controlPollMs: number;
  private readonly connectTimeoutMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly signer: AgentCoreBrowserConnectionSigner,
    private readonly browserIdentifier: string,
    options: AgentCorePlaywrightCaptureEventSourceOptions = {},
  ) {
    if (!browserIdentifier.trim()) throw new Error("browserIdentifier is required");
    this.controlPollMs = positiveInteger(options.controlPollMs ?? DEFAULT_CONTROL_POLL_MS, "capture control poll interval");
    this.connectTimeoutMs = positiveInteger(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, "capture connection timeout");
    this.now = options.now ?? (() => new Date());
  }

  async collect(request: CaptureCollectionSourceRequest): Promise<readonly CaptureEvent[]> {
    // Production launches this task only after the durable AUTH_SETUP -> WORKFLOW transition.
    // Read that authority before attaching listeners so the first observed event cannot be
    // incorrectly classified as authentication setup while a control poll is still pending.
    const initialState = await request.control.getState(
      request.scope,
      request.session.captureSessionId,
    );
    if (initialState.phase !== "WORKFLOW") {
      throw new Error("capture event collection requires WORKFLOW phase");
    }
    if (initialState.finishRequested) return [];

    const connection = await this.signer.sign(this.browserIdentifier, request.session.browserSessionId);
    const browser = await chromium.connectOverCDP(connection.endpoint, {
      headers: { ...connection.headers },
      timeout: this.connectTimeoutMs,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error("AgentCore capture browser has no Playwright context");

    const events: CaptureEvent[] = [];
    let sequence = 0;
    let lastTimestamp = new Date(request.session.startedAt).getTime();

    const timestamp = (): string => {
      const next = Math.max(this.now().getTime(), lastTimestamp + 1);
      lastTimestamp = next;
      return new Date(next).toISOString();
    };
    const append = (event: Omit<CaptureEvent, "eventId" | "sequence" | "occurredAt" | "purpose">): void => {
      sequence += 1;
      events.push({
        ...event,
        eventId: `${request.session.captureSessionId}-event-${sequence}`,
        sequence,
        occurredAt: timestamp(),
        purpose: "WORKFLOW",
      });
    };

    await context.exposeBinding("__automationCaptureEvent", async (_source, payload: unknown) => {
      if (!isBrowserPayload(payload)) return;
      const pageValue = (payload as unknown as { page?: unknown }).page;
      if (!pageValue || typeof pageValue !== "object" || Array.isArray(pageValue)) return;
      const pageRecord = pageValue as Record<string, unknown>;
      const url = safeHttpUrl(pageRecord.url);
      if (!url) return;
      const title = safeString(pageRecord.title);
      const target = normalizeTarget((payload as unknown as { target?: unknown }).target);
      append({
        kind: payload.kind,
        page: { url, ...(title ? { title } : {}) },
        target,
        ...(payload.kind === "INPUT"
          ? {
              input: {
                kind: "RUNTIME_VARIABLE" as const,
                variableName: `capture_input_${sequence + 1}`,
                sensitive: true,
              },
            }
          : {}),
        artifactRefs: [],
      });
    });
    await context.addInitScript({ content: CAPTURE_INSTALLER });

    const attachPage = async (page: Page): Promise<void> => {
      try {
        await page.evaluate(CAPTURE_INSTALLER);
      } catch {
        // Navigation can replace the document while instrumentation is being installed;
        // addInitScript covers the replacement document.
      }
      page.on("framenavigated", async (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = safeHttpUrl(frame.url());
        if (!url) return;
        let title: string | undefined;
        try {
          title = safeString(await page.title());
        } catch {
          title = undefined;
        }
        append({
          kind: "NAVIGATION",
          page: { url, ...(title ? { title } : {}) },
          navigationUrl: url,
          artifactRefs: [],
        });
      });
    };

    for (const page of context.pages()) await attachPage(page);
    context.on("page", (page) => { void attachPage(page); });

    while (true) {
      const state = await request.control.getState(request.scope, request.session.captureSessionId);
      if (state.phase !== "WORKFLOW") {
        throw new Error("capture collection phase changed unexpectedly");
      }
      if (state.finishRequested) break;
      if (this.now().getTime() >= new Date(request.session.expiresAt).getTime()) {
        throw new Error("capture session expired while waiting for completion");
      }
      await delay(this.controlPollMs);
    }

    return events;
  }
}
