import {
  assertCaptureTrace,
  type AutomationRecord,
  type AutomationSchedule,
  type CaptureTrace,
  type RunCheckpoint,
  type RunRecord,
  type WorkflowGraph,
} from "@automation/contracts";
import type {
  AutomationLockManager,
  AutomationRepository,
  BrowserExecutor,
  BrowserProfileStore,
  CheckpointRepository,
  OwnershipScope,
  ReasoningProvider,
  RunRepository,
  SchedulerPort,
  VerificationEngine,
  WorkflowVersionRepository,
} from "./index.js";
import { ScheduledRunCoordinator, type PrepareScheduledRunResult } from "./coordinator.js";
import { WorkflowExecutionEngine, type ExecutionResult } from "./execution.js";
import { transitionRun } from "./run-state.js";
import {
  requiredScheduledCaptureInputs,
  validateScheduledNonSecretInputs,
} from "./scheduled-runtime-inputs.js";
import { normalizeAutomationTargetUrl } from "./target-url-policy.js";
import { compileCaptureTrace } from "./workflow-compiler.js";

export interface CaptureTraceRepository {
  get(scope: OwnershipScope, automationId: string, traceId: string): Promise<CaptureTrace | null>;
  putImmutable(trace: CaptureTrace): Promise<void>;
  list(scope: OwnershipScope, automationId: string): Promise<readonly CaptureTrace[]>;
}

const captureKey = (scope: OwnershipScope, automationId: string, traceId: string): string =>
  `${scope.tenantId}:${scope.userId}:${automationId}:${traceId}`;

export class InMemoryCaptureTraceRepository implements CaptureTraceRepository {
  private readonly records = new Map<string, CaptureTrace>();

  async get(scope: OwnershipScope, automationId: string, traceId: string): Promise<CaptureTrace | null> {
    const trace = this.records.get(captureKey(scope, automationId, traceId));
    return trace ? structuredClone(trace) : null;
  }

  async putImmutable(trace: CaptureTrace): Promise<void> {
    assertCaptureTrace(trace);
    const scope = { tenantId: trace.tenantId, userId: trace.userId };
    const key = captureKey(scope, trace.automationId, trace.traceId);
    if (this.records.has(key)) throw new Error(`capture trace '${trace.traceId}' already exists`);
    this.records.set(key, structuredClone(trace));
  }

  async list(scope: OwnershipScope, automationId: string): Promise<readonly CaptureTrace[]> {
    return [...this.records.values()]
      .filter((trace) => trace.tenantId === scope.tenantId && trace.userId === scope.userId && trace.automationId === automationId)
      .map((trace) => structuredClone(trace))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
}

export interface CreateAutomationDraftRequest {
  scope: OwnershipScope;
  automationId: string;
  name: string;
  websiteUrl: string;
  objective: string;
  consentAcknowledged: boolean;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
}
export interface PersistCaptureRequest { scope: OwnershipScope; trace: CaptureTrace; }
export interface CompileAutomationRequest { scope: OwnershipScope; automationId: string; traceId: string; workflowId: string; }
export interface FreshTestRunRequest { scope: OwnershipScope; automationId: string; runId: string; runtimeVariables?: Readonly<Record<string, unknown>>; }
export interface PublishAutomationRequest {
  scope: OwnershipScope;
  automationId: string;
  workflowVersion: number;
  schedule: AutomationSchedule;
  scheduledNonSecretInputs?: Readonly<Record<string, unknown>>;
  scheduledInputsAreNonSecret?: boolean;
}
export interface DispatchOccurrenceRequest { scope: OwnershipScope; automationId: string; scheduledAt: string; runId: string; runtimeVariables?: Readonly<Record<string, unknown>>; }

export type FreshTestRunResult =
  | { kind: "DUPLICATE"; run: RunRecord; checkpoint: RunCheckpoint | null }
  | { kind: "EXECUTED"; execution: ExecutionResult };
export type DispatchOccurrenceResult =
  | { kind: "NOT_RUN"; preparation: Exclude<PrepareScheduledRunResult, { kind: "READY" }> }
  | { kind: "EXECUTED"; execution: ExecutionResult };

export interface AutomationProductLifecycleDependencies {
  automations: AutomationRepository;
  captures: CaptureTraceRepository;
  workflows: WorkflowVersionRepository;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  profiles: BrowserProfileStore;
  scheduler: SchedulerPort;
  locks: AutomationLockManager;
  browser: BrowserExecutor;
  verifier: VerificationEngine;
  reasoner: ReasoningProvider;
  now?: () => Date;
  lockTtlMs?: number;
}

export const AUTOMATION_DRAFT_LIMITS = {
  automationId: 128,
  name: 160,
  websiteUrl: 2_048,
  objective: 4_000,
} as const;

const WORKFLOW_CAPTURE_AUTHORING_STATUSES = new Set<AutomationRecord["status"]>([
  "DRAFT",
  "COMPILING",
  "READY_TO_TEST",
  "READY_TO_PUBLISH",
  "DISABLED",
]);

/**
 * Capture/recompile is allowed only while no production execution can start. A published
 * automation must first be explicitly disabled through the schedule lifecycle, which makes
 * durable state non-executable before Scheduler is disabled. READY_TO_PUBLISH has not been
 * activated yet and can safely re-enter capture when the user wants to correct the tested plan.
 */
export function canAuthorWorkflowCapture(status: AutomationRecord["status"]): boolean {
  return WORKFLOW_CAPTURE_AUTHORING_STATUSES.has(status);
}

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function boundedNonEmpty(value: string, name: string, maxLength: number): string {
  if (value.length > maxLength) throw new Error(`${name} must be at most ${maxLength} characters`);
  return nonEmpty(value, name);
}

function normalizeWebsiteUrl(value: string): string {
  const bounded = boundedNonEmpty(value, "websiteUrl", AUTOMATION_DRAFT_LIMITS.websiteUrl);
  const normalized = normalizeAutomationTargetUrl(bounded);
  if (normalized.length > AUTOMATION_DRAFT_LIMITS.websiteUrl) {
    throw new Error(`websiteUrl must be at most ${AUTOMATION_DRAFT_LIMITS.websiteUrl} characters`);
  }
  return normalized;
}

function assertSchedule(schedule: AutomationSchedule): void {
  nonEmpty(schedule.expression, "schedule expression");
  nonEmpty(schedule.timezone, "schedule timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }).format(new Date(0)); }
  catch { throw new Error("schedule timezone must be a valid IANA timezone"); }
}

function copyRuntimeVariables(variables: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined {
  return variables ? structuredClone(variables) : undefined;
}

export class AutomationProductLifecycleService {
  private readonly now: () => Date;
  private readonly coordinator: ScheduledRunCoordinator;

  constructor(private readonly dependencies: AutomationProductLifecycleDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.coordinator = new ScheduledRunCoordinator({
      automations: dependencies.automations,
      workflows: dependencies.workflows,
      runs: dependencies.runs,
      checkpoints: dependencies.checkpoints,
      profiles: dependencies.profiles,
      locks: dependencies.locks,
      now: this.now,
      ...(dependencies.lockTtlMs !== undefined ? { lockTtlMs: dependencies.lockTtlMs } : {}),
    });
  }

  async createDraft(request: CreateAutomationDraftRequest): Promise<AutomationRecord> {
    if (!request.consentAcknowledged) throw new Error("explicit authorization/consent acknowledgement is required");
    const automationId = boundedNonEmpty(request.automationId, "automationId", AUTOMATION_DRAFT_LIMITS.automationId);
    const name = boundedNonEmpty(request.name, "name", AUTOMATION_DRAFT_LIMITS.name);
    const objective = boundedNonEmpty(request.objective, "objective", AUTOMATION_DRAFT_LIMITS.objective);
    const websiteUrl = normalizeWebsiteUrl(request.websiteUrl);
    if (await this.dependencies.automations.get(request.scope, automationId)) throw new Error(`automation '${automationId}' already exists in ownership scope`);
    const now = this.now().toISOString();
    const browserProfileRef = await this.dependencies.profiles.create(request.scope, automationId);
    const record: AutomationRecord = {
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      automationId,
      name,
      websiteUrl,
      prompt: objective,
      status: "DRAFT",
      browserProfileRef,
      notifyOnSuccess: request.notifyOnSuccess ?? false,
      notifyOnFailure: request.notifyOnFailure ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.automations.put(record);
    return structuredClone(record);
  }

  async persistCapture(request: PersistCaptureRequest): Promise<CaptureTrace> {
    assertCaptureTrace(request.trace);
    const automation = await this.requireAutomation(request.scope, request.trace.automationId);
    if (!canAuthorWorkflowCapture(automation.status)) {
      throw new Error("automation must be in a non-executing workflow-authoring state before accepting a capture");
    }
    this.assertTraceOwnership(request.scope, automation, request.trace);
    if (!automation.browserProfileRef || automation.browserProfileRef !== request.trace.browserProfileRef) throw new Error("capture trace browser profile does not match the automation");
    if (!(await this.dependencies.profiles.exists(request.scope, automation.browserProfileRef))) throw new Error("capture trace references an unavailable browser profile");
    await this.dependencies.captures.putImmutable(request.trace);
    await this.dependencies.automations.put({ ...automation, status: "COMPILING", updatedAt: this.now().toISOString() });
    return structuredClone(request.trace);
  }

  async compile(request: CompileAutomationRequest): Promise<WorkflowGraph> {
    const automation = await this.requireAutomation(request.scope, request.automationId);
    if (automation.status !== "COMPILING") {
      throw new Error("automation must be COMPILING before workflow compilation");
    }
    const trace = await this.dependencies.captures.get(request.scope, request.automationId, request.traceId);
    if (!trace) throw new Error(`capture trace '${request.traceId}' does not exist in ownership scope`);
    this.assertTraceOwnership(request.scope, automation, trace);
    const versions = await this.dependencies.workflows.list(request.scope, request.automationId);
    const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
    const graph = compileCaptureTrace({ trace, workflowId: nonEmpty(request.workflowId, "workflowId"), version: nextVersion, createdAt: this.now().toISOString() });
    await this.dependencies.workflows.putImmutable(request.scope, graph);
    await this.dependencies.automations.put({ ...automation, status: "READY_TO_TEST", updatedAt: this.now().toISOString() });
    return graph;
  }

  async runFreshTest(request: FreshTestRunRequest): Promise<FreshTestRunResult> {
    const automation = await this.requireAutomation(request.scope, request.automationId);
    if (automation.status !== "READY_TO_TEST" && automation.status !== "READY_TO_PUBLISH") throw new Error("automation must be READY_TO_TEST or READY_TO_PUBLISH before a fresh test");
    if (!automation.browserProfileRef || !(await this.dependencies.profiles.exists(request.scope, automation.browserProfileRef))) throw new Error("automation browser profile is unavailable");
    const graph = await this.latestWorkflow(request.scope, automation.automationId);
    const now = this.now().toISOString();
    const runId = nonEmpty(request.runId, "runId");
    const queued: RunRecord = {
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      runId,
      automationId: automation.automationId,
      workflowVersion: graph.version,
      occurrenceKey: `${automation.automationId}:test:${runId}`,
      status: "QUEUED",
      scheduledAt: now,
    };
    const created = await this.dependencies.runs.createIfAbsent(queued);
    if (!created.created) return { kind: "DUPLICATE", run: created.run, checkpoint: await this.dependencies.checkpoints.get(request.scope, created.run.runId) };
    let run = transitionRun(created.run, "PREFLIGHT", { now });
    await this.dependencies.runs.update(run);
    run = transitionRun(run, "RUNNING", { now });
    await this.dependencies.runs.update(run);
    await this.seedFreshCheckpoint(request.scope, run, graph, request.runtimeVariables);
    const execution = await this.makeEngine().execute({ scope: request.scope, run, graph });
    if (execution.run.status === "SUCCEEDED") {
      await this.dependencies.automations.put({ ...automation, status: "READY_TO_PUBLISH", updatedAt: this.now().toISOString() });
    }
    return { kind: "EXECUTED", execution };
  }

  async publish(request: PublishAutomationRequest): Promise<AutomationRecord> {
    assertSchedule(request.schedule);
    const automation = await this.requireAutomation(request.scope, request.automationId);
    if (automation.status !== "READY_TO_PUBLISH") throw new Error("automation must have a successful fresh test before publish");
    const graph = await this.dependencies.workflows.get(request.scope, automation.automationId, request.workflowVersion);
    if (!graph) throw new Error(`workflow version ${request.workflowVersion} does not exist`);
    const latest = await this.latestWorkflow(request.scope, automation.automationId);
    if (latest.version !== graph.version) throw new Error("only the latest successfully tested workflow version may be published");

    const requiredInputs = requiredScheduledCaptureInputs(graph);
    if (requiredInputs.length > 0 && request.scheduledInputsAreNonSecret !== true) {
      throw new Error("scheduled capture inputs require explicit non-secret acknowledgement");
    }
    const scheduledNonSecretInputs = validateScheduledNonSecretInputs(graph, request.scheduledNonSecretInputs);

    const scheduleId = `automation:${automation.automationId}`;
    await this.dependencies.scheduler.upsert(request.scope, {
      scheduleId,
      automationId: automation.automationId,
      schedule: request.schedule,
      enabled: true,
    });
    const { scheduledNonSecretInputs: _staleScheduledInputs, ...automationWithoutScheduledInputs } = automation;
    const published: AutomationRecord = {
      ...automationWithoutScheduledInputs,
      status: "ACTIVE",
      publishedWorkflowVersion: graph.version,
      schedule: structuredClone(request.schedule),
      ...(Object.keys(scheduledNonSecretInputs).length > 0 ? { scheduledNonSecretInputs } : {}),
      updatedAt: this.now().toISOString(),
    };
    await this.dependencies.automations.put(published);
    return published;
  }

  async dispatchOccurrence(request: DispatchOccurrenceRequest): Promise<DispatchOccurrenceResult> {
    const preparation = await this.coordinator.prepare({
      scope: request.scope,
      automationId: request.automationId,
      scheduledAt: request.scheduledAt,
      runId: request.runId,
      ...(request.runtimeVariables ? { runtimeVariables: structuredClone(request.runtimeVariables) } : {}),
    });
    if (preparation.kind !== "READY") return { kind: "NOT_RUN", preparation };
    try {
      const execution = await this.makeEngine().execute({ scope: request.scope, run: preparation.run, graph: preparation.graph });
      return { kind: "EXECUTED", execution };
    } finally {
      await this.coordinator.releaseLease(request.scope, preparation.lease);
    }
  }

  async history(scope: OwnershipScope, automationId: string): Promise<readonly RunRecord[]> {
    await this.requireAutomation(scope, automationId);
    return this.dependencies.runs.listForAutomation(scope, automationId);
  }

  private async seedFreshCheckpoint(scope: OwnershipScope, run: RunRecord, graph: WorkflowGraph, runtimeVariables?: Readonly<Record<string, unknown>>): Promise<void> {
    const existing = await this.dependencies.checkpoints.get(scope, run.runId);
    if (existing) throw new Error(`fresh run '${run.runId}' already has a checkpoint`);
    const variables = { ...(graph.initialVariables ?? {}), ...(copyRuntimeVariables(runtimeVariables) ?? {}) };
    await this.dependencies.checkpoints.put(scope, {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      currentNodeId: graph.entryNodeId,
      completedNodeIds: [],
      attempt: 0,
      fingerprintRepeatCount: 0,
      variables,
      evidenceRefs: [],
      updatedAt: this.now().toISOString(),
    });
  }

  private makeEngine(): WorkflowExecutionEngine {
    return new WorkflowExecutionEngine({ browser: this.dependencies.browser, verifier: this.dependencies.verifier, reasoner: this.dependencies.reasoner, checkpoints: this.dependencies.checkpoints, runs: this.dependencies.runs, now: this.now, sleep: async () => {}, jitter: () => 0.5 });
  }

  private async requireAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationRecord> {
    const automation = await this.dependencies.automations.get(scope, automationId);
    if (!automation) throw new Error(`automation '${automationId}' does not exist in ownership scope`);
    return automation;
  }

  private async latestWorkflow(scope: OwnershipScope, automationId: string): Promise<WorkflowGraph> {
    const versions = await this.dependencies.workflows.list(scope, automationId);
    const graph = versions.at(-1);
    if (!graph) throw new Error("automation has no compiled workflow");
    return graph;
  }

  private assertTraceOwnership(scope: OwnershipScope, automation: AutomationRecord, trace: CaptureTrace): void {
    if (trace.tenantId !== scope.tenantId || trace.userId !== scope.userId || trace.automationId !== automation.automationId) throw new Error("capture trace ownership does not match automation scope");
    if (normalizeWebsiteUrl(trace.websiteUrl) !== normalizeWebsiteUrl(automation.websiteUrl)) throw new Error("capture trace website does not match automation");
    if (trace.objective.trim() !== automation.prompt.trim()) throw new Error("capture trace objective does not match automation");
  }
}
