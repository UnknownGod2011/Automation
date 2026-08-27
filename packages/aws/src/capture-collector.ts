import type {
  CaptureArtifactRef,
  CaptureEvent,
  CaptureInputControl,
  CaptureInputValue,
  CaptureSemanticTarget,
  VerificationSpec,
} from "@automation/contracts";
import type {
  ArtifactStore,
  CaptureCollectionEventSource,
  CaptureCollectionSourceRequest,
} from "@automation/core";
import { chromium, type Page } from "playwright-core";
import type { AgentCoreBrowserConnectionSigner } from "./browser-session.js";
import { captureSafePageStateFingerprint } from "./capture-verification-state.js";

const DEFAULT_CONTROL_POLL_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_EFFECT_SETTLE_MS = 400;
const DEFAULT_NAVIGATION_ACTION_GRACE_MS = 50;
const MAX_TARGET_FIELD_LENGTH = 512;
const MAX_CAPTURE_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const CAPTURE_INSTALLER = `(() => {
  const key = "__automationCaptureInstalled";
  if (window[key]) return;
  window[key] = true;
  const clip = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : undefined;
  const target = (node) => {
    const raw = node instanceof Element ? node : node?.parentElement;
    const element = raw?.closest?.("button,input,textarea,select,a,[role],[data-testid],[data-test-id]") || raw;
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
    const inputType = element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase();
    emit({
      kind: "INPUT",
      target: target(element),
      inputType,
      checked: element instanceof HTMLInputElement && inputType === "checkbox" ? element.checked : undefined,
    });
  }, true);
  document.addEventListener("submit", (event) => {
    emit({ kind: "SUBMIT", target: target(event.submitter || event.target) });
  }, true);
})()`;

interface BrowserCapturePayload {
  kind: "CLICK" | "INPUT" | "SUBMIT";
  page: { url: string; title?: string };
  target: CaptureSemanticTarget;
  inputType?: string;
  checked?: boolean;
}

interface ReservedEventIdentity {
  eventId: string;
  sequence: number;
  occurredAt: string;
}

interface PendingClick {
  identity: ReservedEventIdentity;
  canceled: boolean;
}

export interface AgentCorePlaywrightCaptureEventSourceOptions {
  controlPollMs?: number;
  connectTimeoutMs?: number;
  effectSettleMs?: number;
  artifacts?: ArtifactStore;
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

export function classifyCaptureInputControl(inputType: unknown): CaptureInputControl {
  const normalized = safeString(inputType, 64)?.toLowerCase();
  switch (normalized) {
    case "textarea":
    case "text":
    case "search":
    case "email":
    case "url":
    case "tel":
    case "number":
    case "date":
    case "time":
    case "datetime-local":
    case "month":
    case "week":
      return "TEXT";
    case "select":
      return "SELECT";
    case "checkbox":
      return "CHECKBOX";
    case "radio":
      return "RADIO";
    case "file":
      return "FILE";
    case "password":
      return "PASSWORD";
    default:
      return "OTHER";
  }
}

function inputVerification(): VerificationSpec {
  return {
    description: "Captured input target remains populated after typing",
    mode: "CUSTOM",
    expected: "capture:input-filled",
    timeoutMs: 5_000,
  };
}

function checkboxVerification(): VerificationSpec {
  return {
    description: "Captured checkbox remains in the demonstrated state",
    mode: "CUSTOM",
    expected: "capture:check-bound-state",
    timeoutMs: 5_000,
  };
}

export function captureInputDescriptor(
  control: CaptureInputControl,
  variableName: string,
  checked: unknown,
): { input: CaptureInputValue; expectedEffect: VerificationSpec } {
  if (control === "CHECKBOX") {
    if (typeof checked !== "boolean") {
      throw new Error("captured checkbox state is required");
    }
    return {
      input: { kind: "PUBLIC_LITERAL", value: checked ? "true" : "false" },
      expectedEffect: checkboxVerification(),
    };
  }
  return {
    input: {
      kind: "RUNTIME_VARIABLE",
      variableName,
      sensitive: true,
    },
    expectedEffect: inputVerification(),
  };
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

async function postActionScreenshot(
  page: Page,
  artifacts: ArtifactStore | undefined,
  request: CaptureCollectionSourceRequest,
  identity: ReservedEventIdentity,
): Promise<readonly CaptureArtifactRef[]> {
  if (!artifacts) return [];
  try {
    const bytes = await page.screenshot({ type: "png", fullPage: false });
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CAPTURE_SCREENSHOT_BYTES) return [];
    const stored = await artifacts.put(
      request.scope,
      `capture/${request.session.captureSessionId}/event-${identity.sequence}.png`,
      Uint8Array.from(bytes),
      "image/png",
    );
    return [{ ref: stored.ref, kind: "SCREENSHOT", contentType: "image/png" }];
  } catch {
    // Capture screenshots are supplementary authoring evidence, not verification
    // authority. Browser/S3 uncertainty must not manufacture or weaken the expected
    // effect contract that independently gates compilation and execution.
    return [];
  }
}

export class AgentCorePlaywrightCaptureEventSource implements CaptureCollectionEventSource {
  private readonly controlPollMs: number;
  private readonly connectTimeoutMs: number;
  private readonly effectSettleMs: number;
  private readonly artifacts: ArtifactStore | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly signer: AgentCoreBrowserConnectionSigner,
    private readonly browserIdentifier: string,
    options: AgentCorePlaywrightCaptureEventSourceOptions = {},
  ) {
    if (!browserIdentifier.trim()) throw new Error("browserIdentifier is required");
    this.controlPollMs = positiveInteger(options.controlPollMs ?? DEFAULT_CONTROL_POLL_MS, "capture control poll interval");
    this.connectTimeoutMs = positiveInteger(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, "capture connection timeout");
    this.effectSettleMs = positiveInteger(options.effectSettleMs ?? DEFAULT_EFFECT_SETTLE_MS, "capture effect settle interval");
    this.artifacts = options.artifacts;
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
    const pendingEffects = new Set<Promise<void>>();
    const pendingClicksByUrl = new Map<string, PendingClick[]>();
    const pendingActionPages = new Map<Page, number>();
    const actionGenerationByPage = new Map<Page, number>();
    let sequence = 0;
    let lastTimestamp = new Date(request.session.startedAt).getTime();

    const timestamp = (): string => {
      const next = Math.max(this.now().getTime(), lastTimestamp + 1);
      lastTimestamp = next;
      return new Date(next).toISOString();
    };
    const reserve = (): ReservedEventIdentity => {
      sequence += 1;
      return {
        eventId: `${request.session.captureSessionId}-event-${sequence}`,
        sequence,
        occurredAt: timestamp(),
      };
    };
    const append = (
      identity: ReservedEventIdentity,
      event: Omit<CaptureEvent, "eventId" | "sequence" | "occurredAt" | "purpose">,
    ): void => {
      events.push({
        ...event,
        ...identity,
        purpose: "WORKFLOW",
      });
    };
    const track = (task: Promise<void>): void => {
      pendingEffects.add(task);
      void task.then(
        () => pendingEffects.delete(task),
        () => pendingEffects.delete(task),
      );
    };
    const addPendingClick = (url: string, pending: PendingClick): void => {
      const existing = pendingClicksByUrl.get(url);
      if (existing) existing.push(pending);
      else pendingClicksByUrl.set(url, [pending]);
    };
    const removePendingClick = (url: string, pending: PendingClick): void => {
      const existing = pendingClicksByUrl.get(url);
      if (!existing) return;
      const next = existing.filter((candidate) => candidate !== pending);
      if (next.length > 0) pendingClicksByUrl.set(url, next);
      else pendingClicksByUrl.delete(url);
    };
    const cancelLatestPendingClick = (url: string): void => {
      const existing = pendingClicksByUrl.get(url);
      const pending = existing?.at(-1);
      if (pending) pending.canceled = true;
    };
    const beginAction = (page: Page): void => {
      pendingActionPages.set(page, (pendingActionPages.get(page) ?? 0) + 1);
      actionGenerationByPage.set(page, (actionGenerationByPage.get(page) ?? 0) + 1);
    };
    const endAction = (page: Page): void => {
      const remaining = (pendingActionPages.get(page) ?? 1) - 1;
      if (remaining > 0) pendingActionPages.set(page, remaining);
      else pendingActionPages.delete(page);
    };
    const trackAction = (page: Page, start: () => Promise<void>): void => {
      beginAction(page);
      track(start().finally(() => endAction(page)));
    };
    const captureAction = async (
      source: { page: Page },
      payload: BrowserCapturePayload,
      identity: ReservedEventIdentity,
      url: string,
      title: string | undefined,
      target: CaptureSemanticTarget,
      shouldAppend: () => boolean = () => true,
    ): Promise<void> => {
      let expectedEffect: VerificationSpec | undefined;
      try {
        await source.page.waitForTimeout(this.effectSettleMs);
        if (!shouldAppend()) return;
        expectedEffect = {
          description: "Browser structure matches the demonstrated post-action state",
          mode: "CUSTOM",
          expected: await captureSafePageStateFingerprint(source.page),
          timeoutMs: 10_000,
        };
      } catch {
        // Never invent verification evidence. The compiler will reject this event
        // if a trustworthy post-effect state could not be captured.
        expectedEffect = undefined;
      }
      if (!shouldAppend()) return;
      const artifactRefs = await postActionScreenshot(
        source.page,
        this.artifacts,
        request,
        identity,
      );
      if (!shouldAppend()) return;
      append(identity, {
        kind: payload.kind,
        page: { url, ...(title ? { title } : {}) },
        target,
        ...(expectedEffect ? { expectedEffect } : {}),
        artifactRefs,
      });
    };

    await context.exposeBinding("__automationCaptureEvent", async (source, payload: unknown) => {
      if (!isBrowserPayload(payload)) return;
      const pageValue = (payload as unknown as { page?: unknown }).page;
      if (!pageValue || typeof pageValue !== "object" || Array.isArray(pageValue)) return;
      const pageRecord = pageValue as Record<string, unknown>;
      const url = safeHttpUrl(pageRecord.url);
      if (!url) return;
      const title = safeString(pageRecord.title);
      const target = normalizeTarget((payload as unknown as { target?: unknown }).target);

      if (payload.kind === "INPUT") {
        const identity = reserve();
        const inputControl = classifyCaptureInputControl(payload.inputType);
        let descriptor: ReturnType<typeof captureInputDescriptor>;
        try {
          descriptor = captureInputDescriptor(
            inputControl,
            `capture_input_${identity.sequence}`,
            payload.checked,
          );
        } catch {
          // Malformed browser-side checkbox data cannot be trusted as replay intent.
          return;
        }
        append(identity, {
          kind: payload.kind,
          page: { url, ...(title ? { title } : {}) },
          target,
          input: descriptor.input,
          inputControl,
          expectedEffect: descriptor.expectedEffect,
          artifactRefs: [],
        });
        return;
      }

      if (payload.kind === "SUBMIT") {
        // Native form submission fires after the initiating click. Suppress the latest
        // unsettled click on the same page so one demonstrated submit cannot compile
        // into two consequential browser actions.
        cancelLatestPendingClick(url);
      }

      const identity = reserve();
      if (payload.kind === "CLICK") {
        const pending: PendingClick = { identity, canceled: false };
        addPendingClick(url, pending);
        trackAction(source.page, () => captureAction(
          source,
          payload,
          identity,
          url,
          title,
          target,
          () => !pending.canceled,
        ).finally(() => removePendingClick(url, pending)));
        return;
      }

      trackAction(source.page, () => captureAction(source, payload, identity, url, title, target));
    });
    await context.addInitScript({ content: CAPTURE_INSTALLER });

    const attachPage = async (page: Page): Promise<void> => {
      try {
        await page.evaluate(CAPTURE_INSTALLER);
      } catch {
        // Navigation can replace the document while instrumentation is being installed;
        // addInitScript covers the replacement document.
      }
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        const actionGeneration = actionGenerationByPage.get(page) ?? 0;
        track((async () => {
          // Browser event handlers call the exposed Playwright binding asynchronously.
          // A very fast navigation can therefore reach Node before the initiating
          // CLICK/SUBMIT. Give that binding a tiny bounded window to claim the page.
          if (pendingActionPages.has(page)) return;
          await delay(DEFAULT_NAVIGATION_ACTION_GRACE_MS);
          if (
            pendingActionPages.has(page)
            || (actionGenerationByPage.get(page) ?? 0) !== actionGeneration
          ) {
            return;
          }
          const url = safeHttpUrl(frame.url());
          if (!url) return;
          let title: string | undefined;
          try {
            title = safeString(await page.title());
          } catch {
            title = undefined;
          }
          append(reserve(), {
            kind: "NAVIGATION",
            page: { url, ...(title ? { title } : {}) },
            navigationUrl: url,
            artifactRefs: [],
          });
        })());
      });
    };

    for (const page of context.pages()) await attachPage(page);
    context.on("page", (page) => { void attachPage(page); });

    if (!request.control.markReady) {
      throw new Error("capture collector readiness control is not configured");
    }
    // This is the user-visible recording readiness boundary: the exposed binding,
    // init script, existing documents, and future-page hook are all installed before
    // the durable control record can tell the product that demonstration may begin.
    await request.control.markReady(
      request.scope,
      request.session.captureSessionId,
      this.now().toISOString(),
    );

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

    await Promise.all([...pendingEffects]);
    return events
      .sort((left, right) => left.sequence - right.sequence)
      .map((event, index) => ({ ...event, sequence: index + 1 }));
  }
}