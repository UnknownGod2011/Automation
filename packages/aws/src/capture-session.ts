import type { AutomationRecord } from "@automation/contracts";
import type {
  BrowserViewport,
  CaptureCollectionControlStore,
  CaptureSessionFinalizer,
  CaptureSessionRecord,
  CaptureSessionStarter,
  CaptureSessionStore,
  CaptureStartResult,
  OwnershipScope,
} from "@automation/core";
import { initialCaptureCollectionControlRecord } from "@automation/core";
import { Browser } from "bedrock-agentcore/browser";
import { parseProfileRef } from "./browser-profile.js";
import { MAX_BROWSER_SESSION_TIMEOUT_SECONDS } from "./config.js";
import { agentCoreClientToken, scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AgentCoreBrowserDataApi } from "./browser-session.js";

const DEFAULT_CAPTURE_TIMEOUT_SECONDS = 3_600;
const DEFAULT_LIVE_VIEW_TTL_SECONDS = 3_600;

export interface AgentCoreBrowserLiveViewSigner {
  sign(browserIdentifier: string, sessionId: string, expiresInSeconds: number): Promise<string>;
}

interface ActiveCaptureSessionReader {
  activeForAutomation(scope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null>;
}

export interface AgentCoreCaptureSessionStarterOptions {
  sessionStore?: CaptureSessionStore;
  controlStore?: CaptureCollectionControlStore;
  sessionTimeoutSeconds?: number;
  liveViewTtlSeconds?: number;
  viewport?: BrowserViewport;
  now?: () => Date;
  captureId?: () => string;
}

function validatePositiveInteger(value: number, name: string, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max} seconds`);
  }
}

function validateOwnership(scope: OwnershipScope, automation: AutomationRecord): void {
  if (automation.tenantId !== scope.tenantId || automation.userId !== scope.userId) {
    throw new Error("automation does not belong to the requested ownership scope");
  }
}

function validateLiveViewUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("AgentCore returned an invalid Live View URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("AgentCore Live View URL must use HTTPS without embedded credentials");
  }
  return parsed.toString();
}

function defaultCaptureId(): string {
  return `capture-${globalThis.crypto.randomUUID()}`;
}

function activeReader(store: CaptureSessionStore): ActiveCaptureSessionReader | null {
  const candidate = store as CaptureSessionStore & Partial<ActiveCaptureSessionReader>;
  return typeof candidate.activeForAutomation === "function"
    ? { activeForAutomation: candidate.activeForAutomation.bind(candidate) }
    : null;
}

function expirationMillis(record: CaptureSessionRecord): number {
  const value = Date.parse(record.expiresAt);
  if (!Number.isFinite(value)) throw new Error("durable capture session has an invalid expiry");
  return value;
}

export class AwsAgentCoreBrowserLiveViewSigner implements AgentCoreBrowserLiveViewSigner {
  constructor(private readonly region: string) {
    if (!region.trim()) throw new Error("AWS region is required for AgentCore Live View signing");
  }

  async sign(browserIdentifier: string, sessionId: string, expiresInSeconds: number): Promise<string> {
    validatePositiveInteger(expiresInSeconds, "Live View URL TTL", MAX_BROWSER_SESSION_TIMEOUT_SECONDS);
    const browser = new Browser({ region: this.region, identifier: browserIdentifier });
    browser.attachSession(sessionId);
    const signedUrl = await browser.generateLiveViewUrl(expiresInSeconds);
    const parsed = new URL(validateLiveViewUrl(signedUrl));
    const expectedHost = `bedrock-agentcore.${this.region}.amazonaws.com`;
    if (parsed.hostname !== expectedHost) {
      throw new Error("AgentCore Live View URL host does not match the configured AWS region");
    }
    return parsed.toString();
  }
}

export class AgentCoreCaptureSessionStarter implements CaptureSessionStarter {
  private readonly sessionStore: CaptureSessionStore | undefined;
  private readonly controlStore: CaptureCollectionControlStore | undefined;
  private readonly sessionTimeoutSeconds: number;
  private readonly liveViewTtlSeconds: number;
  private readonly viewport: BrowserViewport | undefined;
  private readonly now: () => Date;
  private readonly captureId: () => string;

  constructor(
    private readonly api: AgentCoreBrowserDataApi,
    private readonly signer: AgentCoreBrowserLiveViewSigner,
    private readonly browserIdentifier: string,
    options: AgentCoreCaptureSessionStarterOptions = {},
  ) {
    if (!browserIdentifier.trim()) throw new Error("browserIdentifier is required");
    this.sessionStore = options.sessionStore;
    this.controlStore = options.controlStore;
    this.sessionTimeoutSeconds = options.sessionTimeoutSeconds ?? DEFAULT_CAPTURE_TIMEOUT_SECONDS;
    this.liveViewTtlSeconds = options.liveViewTtlSeconds ?? DEFAULT_LIVE_VIEW_TTL_SECONDS;
    validatePositiveInteger(this.sessionTimeoutSeconds, "capture session timeout", MAX_BROWSER_SESSION_TIMEOUT_SECONDS);
    validatePositiveInteger(this.liveViewTtlSeconds, "Live View URL TTL", this.sessionTimeoutSeconds);
    this.viewport = options.viewport ? { ...options.viewport } : undefined;
    this.now = options.now ?? (() => new Date());
    this.captureId = options.captureId ?? defaultCaptureId;
  }

  async start(scope: OwnershipScope, automation: AutomationRecord): Promise<CaptureStartResult> {
    validateOwnership(scope, automation);
    if (!this.sessionStore) throw new Error("durable capture session store is not configured");
    if (!automation.browserProfileRef) {
      throw new Error("automation browser profile is required before capture");
    }
    const profileIdentifier = parseProfileRef(automation.browserProfileRef);
    const startedAt = this.now();
    const reader = activeReader(this.sessionStore);
    if (reader) {
      const current = await reader.activeForAutomation(scope, automation.automationId);
      if (current) {
        if (
          current.tenantId !== scope.tenantId ||
          current.userId !== scope.userId ||
          current.automationId !== automation.automationId
        ) {
          throw new Error("durable active capture identity is invalid");
        }
        if (expirationMillis(current) > startedAt.getTime()) {
          // Live View URLs are intentionally not persisted, so an already-active capture
          // cannot be safely reconstructed by replaying Start. Reject before allocating
          // another Browser and let the existing recording-control state remain authoritative.
          throw new Error("capture session is already active for this automation");
        }
      }
    }

    const captureSessionId = this.captureId().trim();
    if (!captureSessionId || captureSessionId.length > 160) {
      throw new Error("capture session identifier is invalid");
    }

    const identity = scopedResourceIdentity(
      scope,
      automation.automationId,
      captureSessionId,
      this.browserIdentifier,
    );
    const resourceToken = stableResourceToken(identity);
    const session = await this.api.start({
      browserIdentifier: this.browserIdentifier,
      name: `capture-${resourceToken.slice(0, 24)}`,
      timeoutSeconds: this.sessionTimeoutSeconds,
      clientToken: agentCoreClientToken("capture", identity),
      profileIdentifier,
      ...(this.viewport ? { viewport: { ...this.viewport } } : {}),
    });

    try {
      const liveViewUrl = validateLiveViewUrl(
        await this.signer.sign(this.browserIdentifier, session.sessionId, this.liveViewTtlSeconds),
      );
      await this.sessionStore.putStarted({
        tenantId: scope.tenantId,
        userId: scope.userId,
        automationId: automation.automationId,
        captureSessionId,
        browserSessionId: session.sessionId,
        browserProfileRef: automation.browserProfileRef,
        startedAt: startedAt.toISOString(),
        expiresAt: new Date(startedAt.getTime() + this.sessionTimeoutSeconds * 1_000).toISOString(),
        status: "STARTED",
      });
      if (this.controlStore) {
        await this.controlStore.putInitial(initialCaptureCollectionControlRecord({
          scope,
          automationId: automation.automationId,
          captureSessionId,
          updatedAt: startedAt.toISOString(),
        }));
      }
      return {
        kind: "READY",
        captureSessionId,
        liveViewUrl,
        expiresAt: new Date(startedAt.getTime() + this.liveViewTtlSeconds * 1_000).toISOString(),
      };
    } catch (error) {
      try {
        await this.api.stop(this.browserIdentifier, session.sessionId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "AgentCore capture startup failed and session cleanup also failed",
        );
      }
      throw error;
    }
  }
}

export class AgentCoreCaptureSessionFinalizer implements CaptureSessionFinalizer {
  constructor(
    private readonly api: AgentCoreBrowserDataApi,
    private readonly browserIdentifier: string,
  ) {
    if (!browserIdentifier.trim()) throw new Error("browserIdentifier is required");
  }

  async saveProfile(scope: OwnershipScope, record: CaptureSessionRecord): Promise<void> {
    const profileIdentifier = parseProfileRef(record.browserProfileRef);
    const identity = scopedResourceIdentity(
      scope,
      record.automationId,
      record.captureSessionId,
      record.browserSessionId,
      profileIdentifier,
    );
    await this.api.save({
      browserIdentifier: this.browserIdentifier,
      sessionId: record.browserSessionId,
      profileIdentifier,
      clientToken: agentCoreClientToken("capture-save", identity),
    });
  }

  async stop(_scope: OwnershipScope, record: CaptureSessionRecord): Promise<void> {
    await this.api.stop(this.browserIdentifier, record.browserSessionId);
  }
}
