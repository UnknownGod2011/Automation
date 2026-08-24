import type {
  RunCheckpoint,
  RunFailure,
  RunRecord,
} from "@automation/contracts";
import type {
  BrowserExecutor,
  BrowserSessionHandle,
  BrowserSessionManager,
  CheckpointRepository,
  LockLease,
  OwnershipScope,
  ReasoningProvider,
  RunRepository,
  VerificationEngine,
} from "./index.js";
import {
  type PrepareScheduledRunResult,
  type ScheduledRunRequest,
  ScheduledRunCoordinator,
} from "./coordinator.js";
import {
  classifyExecutionError,
} from "./errors.js";
import {
  type ExecutionEngineDependencies,
  type ExecutionResult,
  WorkflowExecutionEngine,
} from "./execution.js";
import {
  FinalizingRunRepository,
} from "./run-finalization.js";
import {
  isTerminalRunStatus,
  transitionRun,
} from "./run-state.js";

const HUMAN_BLOCKING_FAILURES = new Set<RunFailure["code"]>([
  "PROVIDER_AUTH_INVALID",
  "PROVIDER_QUOTA_EXHAUSTED",
  "TARGET_AUTH_REQUIRED",
  "POLICY_BLOCKED",
  "HUMAN_DECISION_REQUIRED",
  "NOT_CONFIGURED",
]);

export interface BrowserExecutionRuntime {
  browser: BrowserExecutor;
  verifier: VerificationEngine;
  close(): Promise<void>;
}

export interface BrowserExecutionRuntimeFactory {
  create(
    scope: OwnershipScope,
    run: RunRecord,
    session: BrowserSessionHandle,
  ): Promise<BrowserExecutionRuntime>;
}

export interface ScheduledRunWorkerDependencies {
  coordinator: ScheduledRunCoordinator;
  sessions: BrowserSessionManager;
  runtimeFactory: BrowserExecutionRuntimeFactory;
  reasoner: ReasoningProvider;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  browserSessionTimeoutSeconds: number;
  now?: () => Date;
  sleep?: ExecutionEngineDependencies["sleep"];
  jitter?: ExecutionEngineDependencies["jitter"];
  repeatedFingerprintLimit?: number;
  maxNodeExecutions?: number;
}

export type ReadyScheduledRun = Extract<PrepareScheduledRunResult, { kind: "READY" }>;
export type NonReadyScheduledRun = Exclude<PrepareScheduledRunResult, ReadyScheduledRun>;

export type ScheduledRunWorkerResult =
  | {
      kind: "NOT_RUN";
      preparation: NonReadyScheduledRun;
      cleanupWarnings: readonly string[];
    }
  | {
      kind: "EXECUTED";
      preparation: ReadyScheduledRun;
      execution: ExecutionResult;
      cleanupWarnings: readonly string[];
    };

class LeaseRenewingCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly delegate: CheckpointRepository,
    private lease: LockLease,
    private readonly renew: (lease: LockLease) => Promise<LockLease>,
  ) {}

  async get(
    scope: OwnershipScope,
    runId: string,
  ): Promise<RunCheckpoint | null> {
    return this.delegate.get(scope, runId);
  }

  async put(
    scope: OwnershipScope,
    checkpoint: RunCheckpoint,
  ): Promise<void> {
    try {
      this.lease = await this.renew(this.lease);
    } catch (error) {
      throw new Error("automation execution lease renewal failed", {
        cause: error,
      });
    }
    await this.delegate.put(scope, checkpoint);
  }

  currentLease(): LockLease {
    return this.lease;
  }
}

function cleanupWarning(operation: string): string {
  return `${operation} failed during cleanup`;
}

export class ScheduledRunWorker {
  private readonly now: () => Date;

  constructor(private readonly dependencies: ScheduledRunWorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    if (
      !Number.isInteger(dependencies.browserSessionTimeoutSeconds) ||
      dependencies.browserSessionTimeoutSeconds < 1
    ) {
      throw new Error("browserSessionTimeoutSeconds must be a positive integer");
    }
  }

  async execute(request: ScheduledRunRequest): Promise<ScheduledRunWorkerResult> {
    const preparation = await this.dependencies.coordinator.prepare(request);
    if (preparation.kind !== "READY") {
      return {
        kind: "NOT_RUN",
        preparation,
        cleanupWarnings: [],
      };
    }

    const cleanupWarnings: string[] = [];
    let session: BrowserSessionHandle | null = null;
    let runtime: BrowserExecutionRuntime | null = null;
    let successProfilePersisted = false;
    const renewingCheckpoints = new LeaseRenewingCheckpointRepository(
      this.dependencies.checkpoints,
      preparation.lease,
      (lease) => this.dependencies.coordinator.renewLease(request.scope, lease),
    );

    try {
      const profileRef = preparation.automation.browserProfileRef;
      if (!profileRef) {
        throw new Error("preflight returned READY without a browser profile");
      }

      session = await this.dependencies.sessions.start(request.scope, {
        automationId: preparation.automation.automationId,
        runId: preparation.run.runId,
        profileRef,
        timeoutSeconds: this.dependencies.browserSessionTimeoutSeconds,
      });
      runtime = await this.dependencies.runtimeFactory.create(
        request.scope,
        preparation.run,
        session,
      );

      const finalizingRuns = new FinalizingRunRepository(
        this.dependencies.runs,
        {
          beforeSuccess: async (run) => {
            if (!session) {
              throw new Error("browser session disappeared before run finalization");
            }
            try {
              await this.dependencies.sessions.saveProfile(
                request.scope,
                session,
                profileRef,
              );
              successProfilePersisted = true;
            } catch (error) {
              const failure = classifyExecutionError(
                error,
                run.currentNodeId ?? preparation.graph.entryNodeId,
                "browser profile persistence",
              );
              throw Object.assign(new Error(failure.message, { cause: error }), {
                classifiedFailure: failure,
              });
            }
          },
        },
      );

      const engine = new WorkflowExecutionEngine({
        browser: runtime.browser,
        reasoner: this.dependencies.reasoner,
        verifier: runtime.verifier,
        checkpoints: renewingCheckpoints,
        runs: finalizingRuns,
        now: this.now,
        ...(this.dependencies.sleep ? { sleep: this.dependencies.sleep } : {}),
        ...(this.dependencies.jitter ? { jitter: this.dependencies.jitter } : {}),
        ...(this.dependencies.repeatedFingerprintLimit !== undefined
          ? { repeatedFingerprintLimit: this.dependencies.repeatedFingerprintLimit }
          : {}),
        ...(this.dependencies.maxNodeExecutions !== undefined
          ? { maxNodeExecutions: this.dependencies.maxNodeExecutions }
          : {}),
      });

      try {
        const execution = await engine.execute({
          scope: request.scope,
          run: preparation.run,
          graph: preparation.graph,
        });
        return {
          kind: "EXECUTED",
          preparation,
          execution,
          cleanupWarnings,
        };
      } catch (error) {
        const classifiedFailure =
          typeof error === "object" &&
          error !== null &&
          "classifiedFailure" in error
            ? (error as { classifiedFailure?: RunFailure }).classifiedFailure
            : undefined;
        const failure =
          classifiedFailure ??
          classifyExecutionError(
            error,
            preparation.graph.entryNodeId,
            session ? "browser profile persistence" : "browser session setup",
          );
        const execution = await this.persistWorkerFailure(
          request.scope,
          preparation.run.runId,
          preparation.graph.entryNodeId,
          failure,
        );
        return {
          kind: "EXECUTED",
          preparation,
          execution,
          cleanupWarnings,
        };
      }
    } catch (error) {
      const failure = classifyExecutionError(
        error,
        preparation.graph.entryNodeId,
        "browser session setup",
      );
      const execution = await this.persistWorkerFailure(
        request.scope,
        preparation.run.runId,
        preparation.graph.entryNodeId,
        failure,
      );
      return {
        kind: "EXECUTED",
        preparation,
        execution,
        cleanupWarnings,
      };
    } finally {
      if (
        session &&
        !successProfilePersisted &&
        preparation.automation.browserProfileRef
      ) {
        try {
          await this.dependencies.sessions.saveProfile(
            request.scope,
            session,
            preparation.automation.browserProfileRef,
          );
        } catch {
          cleanupWarnings.push(cleanupWarning("browser profile persistence"));
        }
      }

      if (runtime) {
        try {
          await runtime.close();
        } catch {
          cleanupWarnings.push(cleanupWarning("browser execution runtime"));
        }
      }

      if (session) {
        try {
          await this.dependencies.sessions.stop(request.scope, session);
        } catch {
          cleanupWarnings.push(cleanupWarning("browser session stop"));
        }
      }

      try {
        await this.dependencies.coordinator.releaseLease(
          request.scope,
          renewingCheckpoints.currentLease(),
        );
      } catch {
        cleanupWarnings.push(cleanupWarning("automation lease release"));
      }
    }
  }

  private async persistWorkerFailure(
    scope: OwnershipScope,
    runId: string,
    fallbackNodeId: string,
    failure: RunFailure,
  ): Promise<ExecutionResult> {
    const current = await this.dependencies.runs.get(scope, runId);
    if (!current) throw new Error(`run '${runId}' disappeared during execution`);

    const existingCheckpoint = await this.dependencies.checkpoints.get(scope, runId);
    const currentNodeId =
      existingCheckpoint?.currentNodeId ?? current.currentNodeId ?? fallbackNodeId;
    const durableFailure: RunFailure = {
      ...failure,
      nodeId: failure.nodeId ?? currentNodeId,
      evidenceRefs: [...failure.evidenceRefs],
    };

    const checkpoint: RunCheckpoint = {
      runId: current.runId,
      automationId: current.automationId,
      workflowVersion: current.workflowVersion,
      currentNodeId,
      completedNodeIds: existingCheckpoint?.completedNodeIds ?? [],
      attempt: existingCheckpoint?.attempt ?? 0,
      fingerprintRepeatCount: existingCheckpoint?.fingerprintRepeatCount ?? 0,
      variables: existingCheckpoint?.variables ?? {},
      evidenceRefs: existingCheckpoint?.evidenceRefs ?? durableFailure.evidenceRefs,
      ...(existingCheckpoint?.stateFingerprint
        ? { stateFingerprint: existingCheckpoint.stateFingerprint }
        : {}),
      lastFailure: durableFailure,
      updatedAt: this.now().toISOString(),
    };
    await this.dependencies.checkpoints.put(scope, checkpoint);

    if (isTerminalRunStatus(current.status) || current.status === "WAITING_FOR_HUMAN") {
      return { run: current, checkpoint };
    }

    const waitForHuman = HUMAN_BLOCKING_FAILURES.has(durableFailure.code);
    const nextRun = transitionRun(
      current,
      waitForHuman ? "WAITING_FOR_HUMAN" : "FAILED",
      {
        now: this.now().toISOString(),
        currentNodeId,
        ...(waitForHuman ? {} : { failure: durableFailure }),
      },
    );
    await this.dependencies.runs.update(nextRun);
    return { run: nextRun, checkpoint };
  }
}
