import type { RunPreflightCheck, RunPreflightCheckResult } from "@automation/core";

export const DEFAULT_AGENTCORE_BROWSER_IDENTIFIER = "aws.browser.v1";
export const DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS = 3_600;
export const MAX_BROWSER_SESSION_TIMEOUT_SECONDS = 28_800;

export interface AwsAdapterConfig {
  region: string;
  browserIdentifier: string;
  browserSessionTimeoutSeconds: number;
}

export type AwsAdapterConfigResult =
  | { configured: true; config: AwsAdapterConfig }
  | { configured: false; missing: readonly string[]; message: string };

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BROWSER_SESSION_TIMEOUT_SECONDS) {
    throw new Error(
      `AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS must be an integer between 1 and ${MAX_BROWSER_SESSION_TIMEOUT_SECONDS}`,
    );
  }
  return parsed;
}

export function loadAwsAdapterConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsAdapterConfigResult {
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  const missing = region ? [] : ["AWS_REGION (or AWS_DEFAULT_REGION)"];
  if (!region) {
    return {
      configured: false,
      missing,
      message: `AWS adapter is not configured: missing ${missing.join(", ")}`,
    };
  }

  return {
    configured: true,
    config: {
      region,
      browserIdentifier:
        env.AWS_AGENTCORE_BROWSER_IDENTIFIER?.trim() || DEFAULT_AGENTCORE_BROWSER_IDENTIFIER,
      browserSessionTimeoutSeconds: parseTimeout(
        env.AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS,
      ),
    },
  };
}

/**
 * Provider-neutral preflight hook consumed by @automation/core. It checks only
 * static adapter configuration; AWS credential resolution remains delegated to
 * the standard AWS SDK credential provider chain (env, workload role, etc.).
 */
export class AwsAdapterConfigurationPreflightCheck implements RunPreflightCheck {
  constructor(private readonly result: AwsAdapterConfigResult) {}

  async check(): Promise<RunPreflightCheckResult> {
    if (this.result.configured) return { ready: true };
    return {
      ready: false,
      disposition: "WAITING_FOR_HUMAN",
      failure: {
        code: "NOT_CONFIGURED",
        message: this.result.message,
        retryable: false,
        evidenceRefs: [],
      },
    };
  }
}
