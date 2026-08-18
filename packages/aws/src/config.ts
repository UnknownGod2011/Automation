import type { RunPreflightCheck, RunPreflightCheckResult } from "@automation/core";

export const DEFAULT_AGENTCORE_BROWSER_IDENTIFIER = "aws.browser.v1";
export const DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS = 3_600;
export const MAX_BROWSER_SESSION_TIMEOUT_SECONDS = 28_800;
export const DEFAULT_STRANDS_MODEL_ID = "global.amazon.nova-2-lite-v1:0";
export const DEFAULT_STRANDS_MAX_TOKENS = 512;
export const DEFAULT_REASONING_CONTEXT_MAX_BYTES = 65_536;

export interface AwsAdapterConfig {
  region: string;
  browserIdentifier: string;
  browserSessionTimeoutSeconds: number;
  strandsModelId: string;
  strandsMaxTokens: number;
  reasoningContextMaxBytes: number;
}

export type AwsAdapterConfigResult =
  | { configured: true; config: AwsAdapterConfig }
  | { configured: false; missing: readonly string[]; message: string };

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  envName: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${envName} must be an integer between ${minimum} and ${maximum}`);
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
      browserSessionTimeoutSeconds: parseBoundedInteger(
        env.AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS,
        DEFAULT_BROWSER_SESSION_TIMEOUT_SECONDS,
        "AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS",
        1,
        MAX_BROWSER_SESSION_TIMEOUT_SECONDS,
      ),
      strandsModelId:
        env.AWS_STRANDS_MODEL_ID?.trim() || DEFAULT_STRANDS_MODEL_ID,
      strandsMaxTokens: parseBoundedInteger(
        env.AWS_STRANDS_MAX_TOKENS,
        DEFAULT_STRANDS_MAX_TOKENS,
        "AWS_STRANDS_MAX_TOKENS",
        64,
        16_384,
      ),
      reasoningContextMaxBytes: parseBoundedInteger(
        env.AWS_REASONING_CONTEXT_MAX_BYTES,
        DEFAULT_REASONING_CONTEXT_MAX_BYTES,
        "AWS_REASONING_CONTEXT_MAX_BYTES",
        1_024,
        1_048_576,
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
