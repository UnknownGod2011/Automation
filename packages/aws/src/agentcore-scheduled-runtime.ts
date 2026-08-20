import type { ScheduledRunWorkerResult } from "@automation/core";
import {
  createAwsScheduledRunBootstrap,
  type AwsScheduledRunBootstrapOptions,
  type AwsScheduledRunBootstrapResult,
} from "./scheduled-run-bootstrap.js";
import type {
  AwsScheduledRunHandler,
  AwsScheduledRunInvocation,
} from "./scheduled-run-handler.js";

const TENANT_ID_ENV = "AUTOMATION_TENANT_ID";
const MAX_RUNTIME_USER_ID_LENGTH = 128;

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
  /** Scheduled dispatch payload supplied by Step Functions. */
  payload: unknown;
}

function validateRuntimeUserId(value: string): string {
  const userId = value.trim();
  if (!userId || userId.length > MAX_RUNTIME_USER_ID_LENGTH) {
    throw new Error("AgentCore Runtime user identity is invalid");
  }
  return userId;
}

/**
 * AgentCore-hosted boundary for scheduled execution.
 *
 * The tenant is deployment-owned and the user identity is supplied separately
 * by AgentCore Runtime. The scheduled payload never establishes authorization;
 * AwsScheduledRunHandler revalidates its embedded scope against this trusted
 * scope before BYOK or browser/model work begins.
 */
export class AwsAgentCoreScheduledRuntimeEntrypoint {
  constructor(
    private readonly configuration: Extract<
      AwsAgentCoreScheduledRuntimeConfiguration,
      { kind: "CONFIGURED" }
    >,
    private readonly handler: Pick<AwsScheduledRunHandler, "handle">,
  ) {}

  handle(
    invocation: AwsAgentCoreScheduledRuntimeInvocation,
  ): Promise<ScheduledRunWorkerResult> {
    const trustedScope = {
      tenantId: this.configuration.tenantId,
      userId: validateRuntimeUserId(invocation.runtimeUserId),
    };
    const scheduledInvocation: AwsScheduledRunInvocation = {
      trustedScope,
      headers: invocation.headers,
      payload: invocation.payload,
    };
    return this.handler.handle(scheduledInvocation);
  }
}

export type AwsAgentCoreScheduledRuntimeResult =
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] }
  | {
      kind: "CONFIGURED";
      entrypoint: AwsAgentCoreScheduledRuntimeEntrypoint;
      bootstrap: Extract<AwsScheduledRunBootstrapResult, { kind: "CONFIGURED" }>;
    };

/**
 * Composes the production scheduled worker for an AgentCore Runtime host.
 * Network calls remain deferred until invocation; missing deployment state is
 * aggregated into a fail-closed NOT_CONFIGURED result.
 */
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
    ),
    bootstrap,
  };
}
