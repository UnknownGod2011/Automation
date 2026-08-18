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

export interface RunPreflightContext {
  scope: OwnershipScope;
  automation: AutomationRecord;
  graph: WorkflowGraph;
  run: RunRecord;
}

export type RunPreflightCheckResult =
  | { ready: true }
  | {
      ready: false;
      disposition: "WAITING_FOR_HUMAN" | "FAILED";
      failure: RunFailure;
    };

export interface RunPreflightCheck {
  check(context: RunPreflightContext): Promise<RunPreflightCheckResult>;
}

export interface ScheduledRunRequest {
  scope: OwnershipScope;
  automationId: string;
  scheduledAt: string;
  runId: string;
}

export type PrepareScheduledRunResult =
  | { kind: "DUPLICATE"; run: RunRecord }
  | { kind: "SKIPPED"; run: RunRecord; reason: "AUTOMATION_NOT_ACTIVE" | "CONCURRENT_RUN" }
  | { kind: "BLOCKED"; run: RunRecord }
  | { kind: "FAILED"; run: RunRecord }
  | {
      kind: "READY";
      automation: AutomationRecord;
      graph: WorkflowGraph;
      run: RunRecord;
      lease: LockLease;
    };

export interface ScheduledRunCoordinatorDependencies {
  automations: AutomationRepository;
  workflows: WorkflowVersionRepository;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  profiles: BrowserProfileStore;
  locks: AutomationLockManager;
  preflightChecks?: readonly RunPreflightCheck[];
  now?: () => Date;
  lockTtlMs?: number;
}

function preflightFailure(code: RunFailure["code"], message: string): RunFailure {
  return { code, message, retryable: false, evidenceRefs: [] };
}

export class ScheduledRunCoordinator {
  private readonly now: () => Date;
  private readonly lockTtlMs: number;
  private readonly preflightChecks: readonly RunPreflightCheck[];

  constructor(private readonly dependencies: ScheduledRunCoordinatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.lockTtlMs = dependencies.lockTtlMs ?? 5 * 60_000;
    this.preflightChecks = dependencies.preflightChecks ?? [];
    if (this.lockTtlMs <= 0) throw new Error("lockTtlMs must be positive");
  }

  async prepare(request: ScheduledRunRequest): Promise<PrepareScheduledRunResult> {
    const automation = await this.dependencies.automations.get(request.scope, request.automationId);
    if (!automation) throw new Error(`automation '${request.automationId}' does not exist in ownership scope`);

    const queued: RunRecord = {
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      runId: request.runId,
      automationId: request.automationId,
      workflowVersion: automation.publishedWorkflowVersion ?? 0,
      occurrenceKey: makeOccurrenceKey(request.automationId, request.scheduledAt),
      status: "QUEUED",
      scheduledAt: new Date(request.scheduledAt).toISOString(),
    };

    const created = await this.dependencies.runs.createIfAbsent(queued);
    if (!created.created) return { kind: "DUPLICATE", run: created.run };

    let run = transitionRun(created.run, "PREFLIGHT", { now: this.now().toISOString() });
    await this.dependencies.runs.update(run);

    if (automation.status !== "ACTIVE") {
      run = transitionRun(run, "SKIPPED", { now: this.now().toISOString() });
      await this.dependencies.runs.update(run);
      return { kind: "SKIPPED", run, reason: "AUTOMATION_NOT_ACTIVE" };
    }

    if (automation.publishedWorkflowVersion === undefined) {
      return this.fail(run, preflightFailure("NOT_CONFIGURED", "active automation has no published workflow version"));
    }

    const graph = await this.dependencies.workflows.get(
      request.scope,
      automation.automationId,
      automation.publishedWorkflowVersion,
    );
    if (!graph) {
      return this.fail(
        run,
        preflightFailure("NOT_CONFIGURED", `published workflow version ${automation.publishedWorkflowVersion} is unavailable`),
      );
    }
    if (graph.automationId !== automation.automationId || graph.version !== automation.publishedWorkflowVersion) {
      return this.fail(run, preflightFailure("NOT_CONFIGURED", "published workflow identity does not match automation"));
    }

    if (!automation.browserProfileRef) {
      return this.block(request.scope, run, graph, preflightFailure("TARGET_AUTH_REQUIRED", "automation has no browser profile"));
    }
    if (!(await this.dependencies.profiles.exists(request.scope, automation.browserProfileRef))) {
      return this.block(request.scope, run, graph, preflightFailure("TARGET_AUTH_REQUIRED", "automation browser profile is unavailable"));
    }

    const context: RunPreflightContext = { scope: request.scope, automation, graph, run };
    for (const check of this.preflightChecks) {
      const result = await check.check(context);
      if (result.ready) continue;
      return result.disposition === "WAITING_FOR_HUMAN"
        ? this.block(request.scope, run, graph, result.failure)
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

  private async block(
    scope: OwnershipScope,
    run: RunRecord,
    graph: WorkflowGraph,
    blocker: RunFailure,
  ): Promise<PrepareScheduledRunResult> {
    await this.dependencies.checkpoints.put(scope, {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      currentNodeId: graph.entryNodeId,
      completedNodeIds: [],
      attempt: 0,
      fingerprintRepeatCount: 0,
      variables: {},
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
