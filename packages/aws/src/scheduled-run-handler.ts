import {
  parseScheduledDispatchEnvelope,
  type OwnershipScope,
  type ReasoningCredentialPoolPolicy,
  type ScheduledRunOutcomeReporter,
  type ScheduledRunRequest,
  type ScheduledRunWorkerResult,
} from "@automation/core";
import {
  OpenAiCredentialBoundReasoningProviderFactory,
  type OpenAiFetch,
} from "./openai-byok-reasoning.js";
import {
  AgentCoreRuntimeHeaderWorkloadAccessTokenSource,
  createAwsByokScheduledExecution,
  type AwsByokScheduledExecutionDependencies,
} from "./scheduled-execution-composition.js";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const OPENAI_MODEL_ENV = "OPENAI_BYOK_MODEL";

export type AwsScheduledRunHandlerConfiguration =
  | { kind: "CONFIGURED"; openAiModel: string }
  | { kind: "NOT_CONFIGURED"; missing: readonly [typeof OPENAI_MODEL_ENV] };

export function readAwsScheduledRunHandlerConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): AwsScheduledRunHandlerConfiguration {
  const model = env[OPENAI_MODEL_ENV]?.trim();
  if (!model) return { kind: "NOT_CONFIGURED", missing: [OPENAI_MODEL_ENV] };
  return { kind: "CONFIGURED", openAiModel: model };
}

export interface AwsScheduledRunInvocation {
  /** Ownership identity established by the trusted execution-plane caller. */
  trustedScope: OwnershipScope;
  /** AgentCore Runtime invocation headers. */
  headers: Readonly<Record<string, string | undefined>>;
  /** Step Functions scheduled-dispatch payload, either decoded or JSON text. */
  payload: unknown;
}

export interface AwsScheduledRunHandlerDependencies {
  coordinator: AwsByokScheduledExecutionDependencies["coordinator"];
  worker: AwsByokScheduledExecutionDependencies["worker"];
  credentials: Omit<AwsByokScheduledExecutionDependencies["credentials"], "providers" | "policy"> & {
    policy: ReasoningCredentialPoolPolicy;
  };
  openAiFetch?: OpenAiFetch;
  runner?: AwsScheduledRunExecutionRunner;
  /** Best-effort reporting; never execution authority. */
  reporter?: Pick<ScheduledRunOutcomeReporter, "report">;
}

export type AwsScheduledRunExecutionRunner = (
  dependencies: AwsByokScheduledExecutionDependencies,
  request: ScheduledRunRequest,
) => Promise<ScheduledRunWorkerResult>;

const defaultRunner: AwsScheduledRunExecutionRunner = async (dependencies, request) =>
  createAwsByokScheduledExecution(dependencies).worker.execute(request);

function sameScope(left: OwnershipScope, right: OwnershipScope): boolean {
  return left.tenantId === right.tenantId && left.userId === right.userId;
}

function decodePayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error("scheduled invocation payload is not valid JSON");
  }
}

export function scheduledOccurrenceRunId(
  scope: OwnershipScope,
  automationId: string,
  scheduledAt: string,
): string {
  const identity = scopedResourceIdentity(scope, "scheduled-run", automationId, scheduledAt);
  return `run-${stableResourceToken(identity)}`;
}

/**
 * Trusted execution-plane entrypoint for one scheduled occurrence.
 *
 * The dispatch envelope is not itself authorization. Its ownership must match
 * the caller-established scope before BYOK resolution or browser/model work is
 * composed. Delivery IDs intentionally do not influence run identity so SQS /
 * Scheduler redelivery converges on the same durable occurrence.
 */
export class AwsScheduledRunHandler {
  private readonly runner: AwsScheduledRunExecutionRunner;
  private readonly providers: OpenAiCredentialBoundReasoningProviderFactory;

  constructor(
    configuration: Extract<AwsScheduledRunHandlerConfiguration, { kind: "CONFIGURED" }>,
    private readonly dependencies: AwsScheduledRunHandlerDependencies,
  ) {
    this.runner = dependencies.runner ?? defaultRunner;
    this.providers = dependencies.openAiFetch
      ? new OpenAiCredentialBoundReasoningProviderFactory(
          { model: configuration.openAiModel },
          dependencies.openAiFetch,
        )
      : new OpenAiCredentialBoundReasoningProviderFactory({
          model: configuration.openAiModel,
        });
  }

  async handle(invocation: AwsScheduledRunInvocation): Promise<ScheduledRunWorkerResult> {
    const envelope = parseScheduledDispatchEnvelope(decodePayload(invocation.payload));
    if (!sameScope(envelope.scope, invocation.trustedScope)) {
      throw new Error("scheduled invocation ownership does not match trusted scope");
    }

    const request: ScheduledRunRequest = {
      scope: { ...invocation.trustedScope },
      automationId: envelope.automationId,
      scheduledAt: envelope.scheduledAt,
      runId: scheduledOccurrenceRunId(
        invocation.trustedScope,
        envelope.automationId,
        envelope.scheduledAt,
      ),
    };

    const reportingAutomation = this.dependencies.reporter
      ? await this.dependencies.coordinator.automations.get(
          invocation.trustedScope,
          envelope.automationId,
        )
      : null;

    const result = await this.runner(
      {
        scope: { ...invocation.trustedScope },
        workloadAccessToken: new AgentCoreRuntimeHeaderWorkloadAccessTokenSource(
          invocation.headers,
        ),
        coordinator: this.dependencies.coordinator,
        worker: this.dependencies.worker,
        credentials: {
          ...this.dependencies.credentials,
          providers: this.providers,
          policy: this.dependencies.credentials.policy,
        },
      },
      request,
    );

    if (this.dependencies.reporter && reportingAutomation) {
      const checkpoint =
        result.kind === "NOT_RUN" && result.preparation.kind === "BLOCKED"
          ? await this.dependencies.worker.checkpoints.get(
              invocation.trustedScope,
              result.preparation.run.runId,
            )
          : null;
      await this.dependencies.reporter.report({
        scope: invocation.trustedScope,
        automation: reportingAutomation,
        result,
        ...(checkpoint ? { checkpoint } : {}),
      });
    }

    return result;
  }
}
