import {
  makeOccurrenceKey,
  type AutomationRecord,
  type RunFailure,
  type RunRecord,
  type WorkflowGraph,
} from "@automation/contracts";
import type {
  AutomationLockManager,
  AutomationRepository,
  BrowserProfileStore,
  CheckpointRepository,
  LockLease,
  OwnershipScope,
  RunRepository,
  WorkflowVersionRepository,
} from "./index.js";
import { transitionRun } from "./run-state.js";
import { validateScheduledNonSecretInputs } from "./scheduled-runtime-inputs.js";

export interface RunPreflightContext {
  scope: OwnershipScope;
  automation: AutomationRecord;
  graph: WorkflowGraph;
  run: RunRecord;
}

export type RunPreflightCheckResult =
  | { ready: true }
  | { ready: false; disposition: "WAITING_FOR_HUMAN" | "FAILED"; failure: RunFailure };

export interface RunPreflightCheck {
  check(context: RunPreflightContext): Promise<RunPreflightCheckResult>;
}

export interface ScheduledRunRequest {
  scope: OwnershipScope;
  automationId: string;
  scheduledAt: string;
  runId: string;
  runtimeVariables?: Readonly<Record<string, unknown>>;
}

export type RunPreparationMode = "SCHEDULED" | "FRESH_TEST";

export type PrepareScheduledRunResult =
  | { kind: "DUPLICATE"; run: RunRecord }
  | { kind: "SKIPPED"; run: RunRecord; reason: "AUTOMATION_NOT_ACTIVE" | "CONCURRENT_RUN" }
  | { kind: "BLOCKED"; run: RunRecord }
  | { kind: "FAILED"; run: RunRecord }
  | { kind: "READY"; automation: AutomationRecord; graph: WorkflowGraph; run: RunRecord; lease: LockLease };

export interface ScheduledRunCoordinatorDependencies {
  automations: AutomationRepository;
  workflows: WorkflowVersionRepository;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  profiles: BrowserProfileStore;
  locks: AutomationLockManager;
  preflightChecks?: readonly RunPreflightCheck[];
  mode?: RunPreparationMode;
  now?: () => Date;
  lockTtlMs?: number;
}

function preflightFailure(code: RunFailure["code"], message: string): RunFailure {
  return { code, message, retryable: false, evidenceRefs: [] };
}

function cloneVariables(
  graph: WorkflowGraph,
  scheduledVariables: Readonly<Record<string, string>>,
  runtimeVariables: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return structuredClone({
    ...(graph.initialVariables ?? {}),
    ...scheduledVariables,
    ...(runtimeVariables ?? {}),
  });
}

export class ScheduledRunCoordinator {
  private readonly now: () => Date;
  private readonly lockTtlMs: number;
  private readonly preflightChecks: readonly RunPreflightCheck[];
  private readonly mode: RunPreparationMode;

  constructor(private readonly dependencies: ScheduledRunCoordinatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.lockTtlMs = dependencies.lockTtlMs ?? 5 * 60_000;
    this.preflightChecks = dependencies.preflightChecks ?? [];
    this.mode = dependencies.mode ?? "SCHEDULED";
    if (this.lockTtlMs <= 0) throw new Error("lockTtlMs must be positive");
  }

  async prepare(request: ScheduledRunRequest): Promise<PrepareScheduledRunResult> {
    const automation = await this.dependencies.automations.get(request.scope, request.automationId);
    if (!automation) throw new Error(`automation '${request.automationId}' does not exist in ownership scope`);

    const graph = await this.resolveGraph(request.scope, automation);
    const scheduledAt = new Date(request.scheduledAt).toISOString();
    const queued: RunRecord = {
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      runId: request.runId,
      automationId: request.automationId,
      workflowVersion: this.mode === "FRESH_TEST" ? graph?.version ?? 0 : automation.publishedWorkflowVersion ?? 0,
      occurrenceKey: this.mode === "FRESH_TEST"
        ? `${request.automationId}:test:${request.runId}`
        : makeOccurrenceKey(request.automationId, request.scheduledAt),
      status: "QUEUED",
      scheduledAt,
    };

    const created = await this.dependencies.runs.createIfAbsent(queued);
    if (!created.created) return { kind: "DUPLICATE", run: created.run };

    let run = transitionRun(created.run, "PREFLIGHT", { now: this.now().toISOString() });
    await this.dependencies.runs.update(run);

    if (this.mode === "SCHEDULED" && automation.status !== "ACTIVE") {
      run = transitionRun(run, "SKIPPED", { now: this.now().toISOString() });
      await this.dependencies.runs.update(run);
      return { kind: "SKIPPED", run, reason: "AUTOMATION_NOT_ACTIVE" };
    }

    if (this.mode === "SCHEDULED" && automation.publishedWorkflowVersion === undefined) {
      return this.fail(run, preflightFailure("NOT_CONFIGURED", "active automation has no published workflow version"));
    }
    if (!graph) {
      return this.fail(
        run,
        preflightFailure(
          "NOT_CONFIGURED",
          this.mode === "FRESH_TEST"
            ? "automation has no compiled workflow version"
            : `published workflow version ${automation.publishedWorkflowVersion ?? 0} is unavailable`,
        ),
      );
    }
    if (graph.automationId !== automation.automationId || (this.mode === "SCHEDULED" && graph.version !== automation.publishedWorkflowVersion)) {
      return this.fail(
        run,
        preflightFailure(
          "NOT_CONFIGURED",
          this.mode === "FRESH_TEST"
            ? "fresh-test workflow identity does not match automation"
            : "published workflow identity does not match automation",
        ),
      );
    }

    let scheduledVariables: Readonly<Record<string, string>> = {};
    if (this.mode === "SCHEDULED") {
      try {
        scheduledVariables = validateScheduledNonSecretInputs(graph, automation.scheduledNonSecretInputs);
      } catch {
        return this.fail(
          run,
          preflightFailure("NOT_CONFIGURED", "published workflow requires scheduled runtime inputs that are not configured"),
        );
      }
    }

    if (!automation.browserProfileRef) {
      return this.block(
        request.scope,
        run,
        graph,
        preflightFailure("TARGET_AUTH_REQUIRED", "automation has no browser profile"),
        scheduledVariables,
        request.runtimeVariables,
      );
    }
    if (!(await this.dependencies.profiles.exists(request.scope, automation.browserProfileRef))) {
      return this.block(
        request.scope,
        run,
        graph,
        preflightFailure("TARGET_AUTH_REQUIRED", "automation browser profile is unavailable"),
        scheduledVariables,
        request.runtimeVariables,
      );
    }

    const context: RunPreflightContext = { scope: request.scope, automation, graph, run };
    for (const check of this.preflightChecks) {
      const result = await check.check(context);
      if (result.ready) continue;
      return result.disposition === "WAITING_FOR_HUMAN"
        ? this.block(request.scope, run, graph, result.failure, scheduledVariables, request.runtimeVariables)
        : this.fail(run, result.failure);
    }

    const lease = await this.dependencies.locks.acquire(
      request.scope,
      automation.automationId,
      run.runId,
      this.lockTtlMs,
    );
    if (!lease) {
      run = transitionRun(run, "SKIPPED", { now: this.now().toISOString() });
      await this.dependencies.runs.update(run);
      return { kind: "SKIPPED", run, reason: "CONCURRENT_RUN" };
    }

    await this.dependencies.checkpoints.put(request.scope, {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: graph.version,
      currentNodeId: graph.entryNodeId,
      completedNodeIds: [],
      attempt: 0,
      fingerprintRepeatCount: 0,
      variables: cloneVariables(graph, scheduledVariables, request.runtimeVariables),
      evidenceRefs: [],
      updatedAt: this.now().toISOString(),
    });

    run = transitionRun(run, "RUNNING", { now: this.now().toISOString() });
    await this.dependencies.runs.update(run);
    return { kind: "READY", automation, graph, run, lease };
  }

  async renewLease(scope: OwnershipScope, lease: LockLease): Promise<LockLease> {
    const renewed = await this.dependencies.locks.renew(scope, lease, this.lockTtlMs);
    if (!renewed) throw new Error("automation execution lease expired before renewal");
    return renewed;
  }

  async releaseLease(scope: OwnershipScope, lease: LockLease): Promise<void> {
    await this.dependencies.locks.release(scope, lease);
  }

  private async resolveGraph(scope: OwnershipScope, automation: AutomationRecord): Promise<WorkflowGraph | null> {
    if (this.mode === "FRESH_TEST") {
      if (automation.status !== "READY_TO_TEST" && automation.status !== "READY_TO_PUBLISH") {
        throw new Error("automation must be READY_TO_TEST or READY_TO_PUBLISH before a fresh test");
      }
      const versions = await this.dependencies.workflows.list(scope, automation.automationId);
      return versions.at(-1) ?? null;
    }
    if (automation.publishedWorkflowVersion === undefined) return null;
    return this.dependencies.workflows.get(scope, automation.automationId, automation.publishedWorkflowVersion);
  }

  private async block(
    scope: OwnershipScope,
    run: RunRecord,
    graph: WorkflowGraph,
    blocker: RunFailure,
    scheduledVariables: Readonly<Record<string, string>>,
    runtimeVariables?: Readonly<Record<string, unknown>>,
  ): Promise<PrepareScheduledRunResult> {
    await this.dependencies.checkpoints.put(scope, {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      currentNodeId: graph.entryNodeId,
      completedNodeIds: [],
      attempt: 0,
      fingerprintRepeatCount: 0,
      variables: cloneVariables(graph, scheduledVariables, runtimeVariables),
      evidenceRefs: blocker.evidenceRefs,
      lastFailure: blocker,
      updatedAt: this.now().toISOString(),
    });
    const blocked = transitionRun(run, "WAITING_FOR_HUMAN", {
      now: this.now().toISOString(),
      currentNodeId: graph.entryNodeId,
    });
    await this.dependencies.runs.update(blocked);
    return { kind: "BLOCKED", run: blocked };
  }

  private async fail(run: RunRecord, failure: RunFailure): Promise<PrepareScheduledRunResult> {
    const failed = transitionRun(run, "FAILED", { now: this.now().toISOString(), failure });
    await this.dependencies.runs.update(failed);
    return { kind: "FAILED", run: failed };
  }
}
