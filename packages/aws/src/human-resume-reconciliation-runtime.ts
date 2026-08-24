import { chromium } from "playwright-core";
import type {
  ArtifactStore,
  HumanResumeReconciliationRuntime,
  HumanResumeReconciliationRuntimeFactory,
  OwnershipScope,
} from "@automation/core";
import { ClassifiedExecutionError } from "@automation/core";
import type { BrowserSessionHandle } from "@automation/core";
import type { FailureCode, RunRecord } from "@automation/contracts";
import {
  AgentCorePlaywrightHumanResumeEffectVerifier,
  type PlaywrightReconciliationObservationPage,
} from "./human-resume-reconciliation-verifier.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export interface PlaywrightReconciliationBrowserContext {
  pages(): readonly PlaywrightReconciliationObservationPage[];
  newPage(): Promise<PlaywrightReconciliationObservationPage>;
}

export interface PlaywrightReconciliationBrowser {
  contexts(): readonly PlaywrightReconciliationBrowserContext[];
  close(): Promise<void>;
}

export type PlaywrightReconciliationConnect = (
  endpoint: string,
  options: { headers: Readonly<Record<string, string>>; timeout: number },
) => Promise<PlaywrightReconciliationBrowser>;

function classifiedFailure(
  code: FailureCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): ClassifiedExecutionError {
  return new ClassifiedExecutionError(
    {
      code,
      message,
      retryable,
      nodeId: "browser-session",
      evidenceRefs: [],
    },
    cause !== undefined ? { cause } : undefined,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function connectionFailure(error: unknown): ClassifiedExecutionError {
  const value = message(error);
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(value)) {
    return classifiedFailure(
      "PROVIDER_AUTH_INVALID",
      "AgentCore Browser reconciliation connection authorization failed",
      false,
      error,
    );
  }
  if (/timeout|timed out|connection closed|websocket.*closed/i.test(value)) {
    return classifiedFailure(
      "TRANSIENT_NETWORK",
      "AgentCore Browser reconciliation connection is temporarily unavailable",
      true,
      error,
    );
  }
  return classifiedFailure(
    "UNKNOWN",
    "AgentCore Browser reconciliation connection failed",
    false,
    error,
  );
}

async function defaultConnect(
  endpoint: string,
  options: { headers: Readonly<Record<string, string>>; timeout: number },
): Promise<PlaywrightReconciliationBrowser> {
  return chromium.connectOverCDP(endpoint, {
    headers: { ...options.headers },
    timeout: options.timeout,
  });
}

/**
 * AWS production runtime for crash reconciliation. Unlike the normal Playwright
 * runtime factory, this returns only the observation verifier and cleanup handle;
 * no BrowserExecutor or model/reasoning capability crosses this boundary.
 */
export class AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory
  implements HumanResumeReconciliationRuntimeFactory
{
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    private readonly connect: PlaywrightReconciliationConnect = defaultConnect,
  ) {
    if (!Number.isSafeInteger(connectTimeoutMs) || connectTimeoutMs <= 0) {
      throw new Error("Playwright reconciliation connect timeout must be a positive safe integer");
    }
  }

  async create(
    _scope: OwnershipScope,
    _run: RunRecord,
    session: BrowserSessionHandle,
  ): Promise<HumanResumeReconciliationRuntime> {
    let browser: PlaywrightReconciliationBrowser;
    try {
      browser = await this.connect(session.connection.endpoint, {
        headers: { ...session.connection.headers },
        timeout: this.connectTimeoutMs,
      });
    } catch (error) {
      throw connectionFailure(error);
    }

    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error("AgentCore Browser reconciliation connection has no default context");
      const page = context.pages()[0] ?? (await context.newPage());
      return {
        verifier: new AgentCorePlaywrightHumanResumeEffectVerifier(page, this.artifacts),
        close: async () => {
          await browser.close();
        },
      };
    } catch (error) {
      try {
        await browser.close();
      } catch {
        // Preserve the setup failure; the outer worker still stops the AgentCore session.
      }
      if (error instanceof ClassifiedExecutionError) throw error;
      throw classifiedFailure(
        "UNKNOWN",
        "AgentCore Browser reconciliation runtime setup failed",
        false,
        error,
      );
    }
  }
}
