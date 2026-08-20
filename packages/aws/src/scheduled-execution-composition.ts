import {
  ClassifiedExecutionError,
  CredentialPoolPreflightCheck,
  CredentialPoolReasoningProvider,
  ScheduledRunCoordinator,
  ScheduledRunWorker,
  type CredentialBoundReasoningProviderFactory,
  type CredentialMetadataRepository,
  type CredentialPoolWarningSink,
  type CredentialVault,
  type OwnershipScope,
  type ReasoningCredentialPoolPolicy,
  type RunPreflightCheck,
  type RunPreflightCheckResult,
  type ScheduledRunCoordinatorDependencies,
  type ScheduledRunWorkerDependencies,
} from "@automation/core";

const WORKLOAD_ACCESS_TOKEN_HEADER = "workloadaccesstoken";
const MAX_WORKLOAD_ACCESS_TOKEN_LENGTH = 131_072;

function sameScope(left: OwnershipScope, right: OwnershipScope): boolean {
  return left.tenantId === right.tenantId && left.userId === right.userId;
}

function validateWorkloadAccessToken(value: string): string {
  const token = value.trim();
  if (!token) {
    throw new Error("AgentCore WorkloadAccessToken is required");
  }
  if (token.length > MAX_WORKLOAD_ACCESS_TOKEN_LENGTH) {
    throw new Error("AgentCore WorkloadAccessToken exceeds the configured safety limit");
  }
  return token;
}

/**
 * Invocation-scoped capability source. The token must come from the trusted
 * AgentCore Runtime invocation boundary; it is not deployment configuration
 * and must never be persisted or logged.
 */
export interface AgentCoreWorkloadAccessTokenSource {
  get(): string;
}

/**
 * Reads the AgentCore Runtime payload header named `WorkloadAccessToken`.
 * Header matching is case-insensitive and conflicting duplicate values fail
 * closed instead of guessing which capability should be used.
 */
export class AgentCoreRuntimeHeaderWorkloadAccessTokenSource
  implements AgentCoreWorkloadAccessTokenSource
{
  constructor(
    private readonly headers: Readonly<Record<string, string | undefined>>,
  ) {}

  get(): string {
    const matches = Object.entries(this.headers)
      .filter(([name, value]) =>
        name.toLowerCase() === WORKLOAD_ACCESS_TOKEN_HEADER && value !== undefined,
      )
      .map(([, value]) => validateWorkloadAccessToken(value ?? ""));

    if (matches.length === 0) {
      throw new Error("AgentCore WorkloadAccessToken is required");
    }
    if (new Set(matches).size !== 1) {
      throw new Error("conflicting AgentCore WorkloadAccessToken headers are not allowed");
    }
    return matches[0] as string;
  }
}

class BoundInvocationScopePreflightCheck implements RunPreflightCheck {
  constructor(private readonly scope: OwnershipScope) {}

  async check(
    context: Parameters<RunPreflightCheck["check"]>[0],
  ): Promise<RunPreflightCheckResult> {
    if (sameScope(context.scope, this.scope)) return { ready: true };
    return {
      ready: false,
      disposition: "FAILED",
      failure: {
        code: "POLICY_BLOCKED",
        message: "scheduled execution scope does not match the trusted invocation scope",
        retryable: false,
        evidenceRefs: [],
      },
    };
  }
}

export interface AwsByokScheduledExecutionDependencies {
  /** Scope authenticated by the trusted execution-plane invocation boundary. */
  scope: OwnershipScope;
  workloadAccessToken: AgentCoreWorkloadAccessTokenSource;
  coordinator: ScheduledRunCoordinatorDependencies;
  worker: Omit<ScheduledRunWorkerDependencies, "coordinator" | "reasoner">;
  credentials: {
    metadata: CredentialMetadataRepository;
    vault: CredentialVault;
    providers: CredentialBoundReasoningProviderFactory;
    policy: ReasoningCredentialPoolPolicy;
    warnings?: CredentialPoolWarningSink;
  };
}

export interface AwsByokScheduledExecution {
  coordinator: ScheduledRunCoordinator;
  reasoner: CredentialPoolReasoningProvider;
  worker: ScheduledRunWorker;
}

/**
 * Composes the production scheduled-run worker with BYOK preflight and
 * invocation-time AgentCore Identity secret resolution.
 *
 * Construct this once per trusted execution-plane invocation. The workload
 * token is retained only by the in-memory reasoner closure and is never added
 * to workflow/run/checkpoint metadata.
 */
export function createAwsByokScheduledExecution(
  dependencies: AwsByokScheduledExecutionDependencies,
): AwsByokScheduledExecution {
  const executionIdentityToken = validateWorkloadAccessToken(
    dependencies.workloadAccessToken.get(),
  );
  const boundScope: OwnershipScope = {
    tenantId: dependencies.scope.tenantId,
    userId: dependencies.scope.userId,
  };

  const credentialPreflight = new CredentialPoolPreflightCheck(
    dependencies.credentials.metadata,
    dependencies.credentials.policy,
  );
  const invocationScopePreflight = new BoundInvocationScopePreflightCheck(boundScope);
  const coordinator = new ScheduledRunCoordinator({
    ...dependencies.coordinator,
    preflightChecks: [
      invocationScopePreflight,
      credentialPreflight,
      ...(dependencies.coordinator.preflightChecks ?? []),
    ],
  });

  const reasoner = new CredentialPoolReasoningProvider({
    metadata: dependencies.credentials.metadata,
    vault: dependencies.credentials.vault,
    providers: dependencies.credentials.providers,
    policy: dependencies.credentials.policy,
    accessContext: (request) => {
      if (!sameScope(request.scope, boundScope)) {
        throw new ClassifiedExecutionError({
          code: "POLICY_BLOCKED",
          message: "reasoning scope does not match the trusted invocation scope",
          retryable: false,
          nodeId: request.node.id,
          evidenceRefs: [],
        });
      }
      return { executionIdentityToken };
    },
    ...(dependencies.credentials.warnings
      ? { warnings: dependencies.credentials.warnings }
      : {}),
  });

  const worker = new ScheduledRunWorker({
    ...dependencies.worker,
    coordinator,
    reasoner,
  });

  return { coordinator, reasoner, worker };
}
