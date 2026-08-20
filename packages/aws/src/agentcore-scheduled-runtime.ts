import type {
  FreshTestRunResult,
  ScheduledRunWorkerResult,
} from "@automation/core";
import {
  createAwsScheduledRunBootstrap,
  type AwsScheduledRunBootstrapOptions,
  type AwsScheduledRunBootstrapResult,
} from "./scheduled-run-bootstrap.js";
import type {
  AwsScheduledRunHandler,
  AwsScheduledRunInvocation,
} from "./scheduled-run-handler.js";
import {
  isAwsAgentCoreFreshTestPayload,
  type AwsFreshTestRunHandler,
} from "./fresh-test-runtime.js";

const TENANT_ID_ENV = "AUTOMATION_TENANT_ID";
const MAX_RUNTIME_USER_ID_LENGTH = 128;
export const AGENTCORE_RUNTIME_USER_ID_HEADER =
  "x-amzn-bedrock-agentcore-runtime-user-id";

export type AwsAgentCoreRuntimeHttpHeaderValue =
  | string
  | readonly string[]
  | undefined;

export type AwsAgentCoreScheduledRuntimeConfiguration =
  | { kind: "CONFIGURED"; tenantId: string }
  | { kind: "NOT_CONFIGURED"; missing: readonly [typeof TENANT_ID_ENV] };

export function readAwsAgentCoreScheduledRuntimeConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): AwsAgentCoreScheduledRuntimeConfiguration {
  const tenantId = env[TENANT_ID_ENV]?.trim();
  if (!tenantId) return { kind: "NOT_CONFIGURED", missing: [TENANT_ID_ENV] };
  return { kind: "CONFIGURED", tenantId };
}

export interface AwsAgentCoreScheduledRuntimeInvocation {
  /** User identity supplied by AgentCore Runtime's trusted invocation context. */
  runtimeUserId: string;
  /** Runtime-injected invocation headers, including WorkloadAccessToken. */
  headers: Readonly<Record<string, string | undefined>>;
  /** Scheduled dispatch or fresh-test payload. */
  payload: unknown;
}

export interface AwsAgentCoreScheduledRuntimeHttpRequest {
  headers: Readonly<Record<string, AwsAgentCoreRuntimeHttpHeaderValue>>;
  payload: unknown;
}

function normalizeRuntimeHeaders(
  input: Readonly<Record<string, AwsAgentCoreRuntimeHttpHeaderValue>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) continue;
    const name = rawName.trim().toLowerCase();
    if (!name) throw new Error("AgentCore Runtime returned an invalid header name");
    const values = typeof rawValue === "string" ? [rawValue] : [...rawValue];
    if (values.length !== 1) {
      throw new Error("AgentCore Runtime returned a multi-valued invocation header");
    }
    const value = values[0] ?? "";
    const existing = normalized[name];
    if (existing !== undefined && existing !== value) {
      throw new Error("AgentCore Runtime returned conflicting invocation headers");
    }
    normalized[name] = value;
  }
  return normalized;
}

export function createAwsAgentCoreScheduledRuntimeInvocationFromHttp(
  request: AwsAgentCoreScheduledRuntimeHttpRequest,
): AwsAgentCoreScheduledRuntimeInvocation {
  const headers = normalizeRuntimeHeaders(request.headers);
  return {
    runtimeUserId: headers[AGENTCORE_RUNTIME_USER_ID_HEADER] ?? "",
    headers,
    payload: request.payload,
  };
}

function validateRuntimeUserId(value: string): string {
  const userId = value.trim();
  if (!userId || userId.length > MAX_RUNTIME_USER_ID_LENGTH) {
    throw new Error("AgentCore Runtime user identity is invalid");
  }
  return userId;
}

export type AwsAgentCoreRuntimeExecutionResult =
  | ScheduledRunWorkerResult
  | FreshTestRunResult;

/**
 * AgentCore-hosted boundary for scheduled execution and explicit fresh tests.
 * Tenant/user ownership is always reconstructed from Runtime context; fresh
 * test JSON carries no ownership identity and cannot supply a workload token.
 */
export class AwsAgentCoreScheduledRuntimeEntrypoint {
  constructor(
    private readonly configuration: Extract<
      AwsAgentCoreScheduledRuntimeConfiguration,
      { kind: "CONFIGURED" }
    >,
    private readonly handler: Pick<AwsScheduledRunHandler, "handle">,
    private readonly freshTestHandler?: Pick<AwsFreshTestRunHandler, "handle">,
  ) {}

  async handle(
    invocation: AwsAgentCoreScheduledRuntimeInvocation,
  ): Promise<AwsAgentCoreRuntimeExecutionResult> {
    const trustedScope = {
      tenantId: this.configuration.tenantId,
      userId: validateRuntimeUserId(invocation.runtimeUserId),
    };
    const trustedInvocation: AwsScheduledRunInvocation = {
      trustedScope,
      headers: invocation.headers,
      payload: invocation.payload,
    };
    if (isAwsAgentCoreFreshTestPayload(invocation.payload)) {
      if (!this.freshTestHandler) {
        throw new Error("AgentCore fresh-test execution is not configured");
      }
      return this.freshTestHandler.handle(trustedInvocation);
    }
    return this.handler.handle(trustedInvocation);
  }
}

export type AwsAgentCoreScheduledRuntimeResult =
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] }
  | {
      kind: "CONFIGURED";
      entrypoint: AwsAgentCoreScheduledRuntimeEntrypoint;
      bootstrap: Extract<AwsScheduledRunBootstrapResult, { kind: "CONFIGURED" }>;
    };

export function createAwsAgentCoreScheduledRuntime(
  options: AwsScheduledRunBootstrapOptions,
): AwsAgentCoreScheduledRuntimeResult {
  const runtime = readAwsAgentCoreScheduledRuntimeConfiguration(options.env);
  const bootstrap = createAwsScheduledRunBootstrap(options);
  const missing = [
    ...(runtime.kind === "CONFIGURED" ? [] : runtime.missing),
    ...(bootstrap.kind === "CONFIGURED" ? [] : bootstrap.missing),
  ];
  const uniqueMissing = [...new Set(missing)];
  if (
    uniqueMissing.length > 0 ||
    runtime.kind !== "CONFIGURED" ||
    bootstrap.kind !== "CONFIGURED"
  ) {
    return { kind: "NOT_CONFIGURED", missing: uniqueMissing };
  }

  return {
    kind: "CONFIGURED",
    entrypoint: new AwsAgentCoreScheduledRuntimeEntrypoint(
      runtime,
      bootstrap.handler,
      bootstrap.freshTestHandler,
    ),
    bootstrap,
  };
}
