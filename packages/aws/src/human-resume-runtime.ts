import { RUN_STATUSES, type RunRecord } from "@automation/contracts";
import {
  ClassifiedExecutionError,
  CredentialPoolReasoningProvider,
  HumanResolutionCoordinator,
  HumanResumeOrchestrator,
  HumanResumeWorker,
  type AutomationRepository,
  type BrowserExecutionRuntimeFactory,
  type BrowserSessionManager,
  type CheckpointRepository,
  type CredentialMetadataRepository,
  type CredentialVault,
  type HumanResolutionClaimStore,
  type HumanResumeAuditStore,
  type HumanResumeEffectReconciliationStore,
  type HumanResumeExecutionLeaseStore,
  type HumanResumeExecutionPort,
  type HumanResumeSubmission,
  type HumanResumeSubmissionResult,
  type OwnershipScope,
  type ReasoningCredentialPoolPolicy,
  type RunRepository,
  type WorkflowVersionRepository,
} from "@automation/core";
import {
  OpenAiCredentialBoundReasoningProviderFactory,
  type OpenAiFetch,
} from "./openai-byok-reasoning.js";
import {
  AgentCoreRuntimeHeaderWorkloadAccessTokenSource,
} from "./scheduled-execution-composition.js";
import {
  agentCoreClientToken,
  scopedResourceIdentity,
} from "./idempotency.js";
import type {
  AgentCoreFreshTestInvokeApi,
  AwsAgentCoreFreshTestConfiguration,
} from "./fresh-test-runtime.js";
import { AwsSdkAgentCoreFreshTestInvokeApi } from "./fresh-test-runtime.js";
import type { AwsScheduledRunInvocation } from "./scheduled-run-handler.js";

const MAX_RUNTIME_BODY_BYTES = 1_048_576;
const MAX_ID_LENGTH = 160;
const MAX_RUNTIME_USER_ID_LENGTH = 128;
const HUMAN_RESUME_LEASE_TTL_MS = 120_000;
const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);

export interface AwsAgentCoreHumanResumePayload {
  kind: "HUMAN_RESUME";
  automationId: string;
  runId: string;
  expectedNodeId: string;
  resolutionId: string;
}

function token(value: string, name: string, max = MAX_ID_LENGTH): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${name} is invalid`);
  return normalized;
}

function sameScope(a: OwnershipScope, b: OwnershipScope): boolean {
  return a.tenantId === b.tenantId && a.userId === b.userId;
}

export function isAwsAgentCoreHumanResumePayload(value: unknown): value is AwsAgentCoreHumanResumePayload {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Readonly<Record<string, unknown>>).kind === "HUMAN_RESUME"
  );
}

function parseRuntimePayload(value: unknown): AwsAgentCoreHumanResumePayload {
  if (!isAwsAgentCoreHumanResumePayload(value)) throw new Error("human-resume payload kind is invalid");
  const record = value as unknown as Readonly<Record<string, unknown>>;
  if (
    typeof record.automationId !== "string" ||
    typeof record.runId !== "string" ||
    typeof record.expectedNodeId !== "string" ||
    typeof record.resolutionId !== "string"
  ) {
    throw new Error("human-resume payload identity is invalid");
  }
  return {
    kind: "HUMAN_RESUME",
    automationId: token(record.automationId, "automationId"),
    runId: token(record.runId, "runId"),
    expectedNodeId: token(record.expectedNodeId, "expectedNodeId"),
    resolutionId: token(record.resolutionId, "resolutionId", 512),
  };
}

function parseResult(payload: string): HumanResumeSubmissionResult {
  if (new TextEncoder().encode(payload).byteLength > MAX_RUNTIME_BODY_BYTES) {
    throw new Error("AgentCore Runtime human-resume response is too large");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new Error("AgentCore Runtime human-resume response is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentCore Runtime human-resume response is invalid");
  }
  const result = value as Readonly<Record<string, unknown>>;
  if (
    !["RESUMED", "DUPLICATE", "BUSY", "CONFLICT", "NOT_WAITING"].includes(String(result.kind)) ||
    typeof result.runId !== "string" ||
    typeof result.status !== "string" ||
    !RUN_STATUS_SET.has(result.status)
  ) {
    throw new Error("AgentCore Runtime human-resume response has an invalid result");
  }
  return value as HumanResumeSubmissionResult;
}

/** Control-plane adapter: invokes the trusted AgentCore Runtime, never browser/model work in Lambda. */
export class AwsAgentCoreHumanResumeExecutionPort implements HumanResumeExecutionPort {
  private readonly api: AgentCoreFreshTestInvokeApi;

  constructor(
    private readonly configuration: Extract<AwsAgentCoreFreshTestConfiguration, { kind: "CONFIGURED" }>,
    api?: AgentCoreFreshTestInvokeApi,
  ) {
    this.api = api ?? new AwsSdkAgentCoreFreshTestInvokeApi(configuration.region);
  }

  async execute(request: HumanResumeSubmission): Promise<HumanResumeSubmissionResult> {
    if (request.scope.tenantId !== this.configuration.tenantId) {
      throw new Error("human-resume ownership does not match the configured tenant");
    }
    const payload: AwsAgentCoreHumanResumePayload = {
      kind: "HUMAN_RESUME",
      automationId: token(request.automationId, "automationId"),
      runId: token(request.runId, "runId"),
      expectedNodeId: token(request.expectedNodeId, "expectedNodeId"),
      resolutionId: token(request.resolutionId, "resolutionId", 512),
    };
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RUNTIME_BODY_BYTES) {
      throw new Error("human-resume request is too large");
    }
    const runtimeUserId = token(request.scope.userId, "userId", MAX_RUNTIME_USER_ID_LENGTH);
    const identity = scopedResourceIdentity(
      request.scope,
      "human-resume",
      payload.runId,
      payload.expectedNodeId,
      payload.resolutionId,
    );
    const response = await this.api.invoke({
      runtimeArn: this.configuration.runtimeArn,
      runtimeSessionId: agentCoreClientToken("human-resume", identity),
      runtimeUserId,
      payload: serialized,
    });
    return parseResult(response);
  }
}

export interface AwsHumanResumeRunHandlerDependencies {
  automations: AutomationRepository;
  workflows: WorkflowVersionRepository;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  sessions: BrowserSessionManager;
  runtimeFactory: BrowserExecutionRuntimeFactory;
  claims: HumanResolutionClaimStore;
  leases: HumanResumeExecutionLeaseStore;
  effects: HumanResumeEffectReconciliationStore;
  audit?: HumanResumeAuditStore;
  credentialMetadata: CredentialMetadataRepository;
  credentialVault: CredentialVault;
  credentialPolicy: ReasoningCredentialPoolPolicy;
  openAiModel: string;
  browserSessionTimeoutSeconds: number;
  openAiFetch?: OpenAiFetch;
  now?: () => Date;
}

/** Runtime-side handler that composes the existing durable resume engine per trusted invocation. */
export class AwsHumanResumeRunHandler {
  private readonly now: () => Date;

  constructor(private readonly dependencies: AwsHumanResumeRunHandlerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async handle(invocation: AwsScheduledRunInvocation): Promise<HumanResumeSubmissionResult> {
    const payload = parseRuntimePayload(invocation.payload);
    const scope = invocation.trustedScope;
    const run = await this.dependencies.runs.get(scope, payload.runId);
    if (!run || run.automationId !== payload.automationId) {
      throw new Error("human-resume run does not match the trusted ownership boundary");
    }
    if (run.status !== "WAITING_FOR_HUMAN") {
      return { kind: "NOT_WAITING", runId: run.runId, status: run.status };
    }

    const workloadAccessToken = new AgentCoreRuntimeHeaderWorkloadAccessTokenSource(
      invocation.headers,
    ).get();
    const providerFactory = this.dependencies.openAiFetch
      ? new OpenAiCredentialBoundReasoningProviderFactory(
          { model: this.dependencies.openAiModel },
          this.dependencies.openAiFetch,
        )
      : new OpenAiCredentialBoundReasoningProviderFactory({ model: this.dependencies.openAiModel });
    const reasoner = new CredentialPoolReasoningProvider({
      metadata: this.dependencies.credentialMetadata,
      vault: this.dependencies.credentialVault,
      providers: providerFactory,
      policy: this.dependencies.credentialPolicy,
      accessContext: (request) => {
        if (!sameScope(request.scope, scope)) {
          throw new ClassifiedExecutionError({
            code: "POLICY_BLOCKED",
            message: "human-resume reasoning scope does not match the trusted invocation scope",
            retryable: false,
            nodeId: request.node.id,
            evidenceRefs: [],
          });
        }
        return { executionIdentityToken: workloadAccessToken };
      },
    });

    const resolutions = new HumanResolutionCoordinator({
      runs: this.dependencies.runs,
      checkpoints: this.dependencies.checkpoints,
      claims: this.dependencies.claims,
      now: this.now,
    });
    const worker = new HumanResumeWorker({
      automations: this.dependencies.automations,
      workflows: this.dependencies.workflows,
      sessions: this.dependencies.sessions,
      runtimeFactory: this.dependencies.runtimeFactory,
      reasoner,
      runs: this.dependencies.runs,
      checkpoints: this.dependencies.checkpoints,
      leases: this.dependencies.leases,
      effects: this.dependencies.effects,
      effectId: () => globalThis.crypto.randomUUID(),
      browserSessionTimeoutSeconds: this.dependencies.browserSessionTimeoutSeconds,
      leaseTtlMs: HUMAN_RESUME_LEASE_TTL_MS,
      now: this.now,
    });
    const orchestrator = new HumanResumeOrchestrator({
      resolutions,
      leases: this.dependencies.leases,
      executor: worker,
      ownerToken: () => globalThis.crypto.randomUUID(),
      leaseTtlMs: HUMAN_RESUME_LEASE_TTL_MS,
      now: this.now,
      ...(this.dependencies.audit
        ? {
            audit: this.dependencies.audit,
            auditEventId: () => globalThis.crypto.randomUUID(),
          }
        : {}),
    });

    const outcome = await orchestrator.execute({
      scope,
      runId: payload.runId,
      expectedNodeId: payload.expectedNodeId,
      resolutionId: payload.resolutionId,
    });
    if (outcome.kind === "EXECUTED") {
      return {
        kind: "RESUMED",
        runId: payload.runId,
        status: outcome.execution.run.status,
      };
    }
    if (outcome.kind === "NOT_EXECUTED") {
      const current = await this.dependencies.runs.get(scope, payload.runId);
      const status: RunRecord["status"] = current?.status ?? run.status;
      return {
        kind: outcome.claim.status === "REPLAY" ? "DUPLICATE" : "CONFLICT",
        runId: payload.runId,
        status,
      };
    }
    return {
      kind: outcome.lease.status === "BUSY" ? "BUSY" : "CONFLICT",
      runId: payload.runId,
      status: run.status,
    };
  }
}
