import type { AutomationRecord } from "@automation/contracts";
import type { BrowserViewport, CaptureSessionStarter, CaptureStartResult, OwnershipScope } from "@automation/core";
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

export interface AgentCoreCaptureSessionStarterOptions {
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
  private readonly sessionTimeoutSeconds: number;
  private readonly liveViewTtlSeconds: number;
  private readonly viewport?: BrowserViewport;
  private readonly now: () => Date;
  private readonly captureId: () => string;

  constructor(
    private readonly api: AgentCoreBrowserDataApi,
    private readonly signer: AgentCoreBrowserLiveViewSigner,
    private readonly browserIdentifier: string,
    options: AgentCoreCaptureSessionStarterOptions = {},
  ) {
    if (!browserIdentifier.trim()) throw new Error("browserIdentifier is required");
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
    if (!automation.browserProfileRef) {
      throw new Error("automation browser profile is required before capture");
    }
    const profileIdentifier = parseProfileRef(automation.browserProfileRef);
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
    const startedAt = this.now();
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
          "AgentCore capture Live View signing failed and session cleanup also failed",
        );
      }
      throw error;
    }
  }
}
