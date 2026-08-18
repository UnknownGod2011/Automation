import type { RunCheckpoint } from "@automation/contracts";
import type {
  AutomationRepository,
  BrowserSessionHandle,
  BrowserSessionManager,
  CheckpointRepository,
  ReasoningProvider,
  RunRepository,
  WorkflowVersionRepository,
} from "./index.js";
import {
  type ExecutionEngineDependencies,
  type ExecutionResult,
  WorkflowExecutionEngine,
} from "./execution.js";
import type {
  HumanResumeExecutionRequest,
  HumanResumeExecutor,
} from "./human-resume.js";
import type {
  HumanResumeExecutionLease,
  HumanResumeExecutionLeaseStore,
} from "./human-resume-lease.js";
import { FinalizingRunRepository } from "./run-finalization.js";
import type { BrowserExecutionRuntime, BrowserExecutionRuntimeFactory } from "./worker.js";

export interface HumanResumeWorkerDependencies {
  automations: AutomationRepository;
  workflows: WorkflowVersionRepository;
  sessions: BrowserSessionManager;
  runtimeFactory: BrowserExecutionRuntimeFactory;
  reasoner: ReasoningProvider;
  runs: RunRepository;
  checkpoints: CheckpointRepository;
  leases: HumanResumeExecutionLeaseStore;
  browserSessionTimeoutSeconds: number;
  leaseTtlMs: number;
  now?: () => Date;
  sleep?: ExecutionEngineDependencies["sleep"];
  jitter?: ExecutionEngineDependencies["jitter"];
  repeatedFingerprintLimit?: number;
  maxNodeExecutions?: number;
  onCleanupWarning?: (warning: string) => void;
}

class LeaseRenewingCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly delegate: CheckpointRepository,
    private lease: HumanResumeExecutionLease,
    private readonly renew: (
      lease: HumanResumeExecutionLease,
    ) => Promise<HumanResumeExecutionLease>,
  ) {}

  async get(scope: { tenantId: string; userId: string }, runId: string): Promise<RunCheckpoint | null> {
    return this.delegate.get(scope, runId);
  }

  async put(scope: { tenantId: string; userId: string }, checkpoint: RunCheckpoint): Promise<void> {
    this.lease = await this.renew(this.lease);
    await this.delegate.put(scope, checkpoint);
  }

  currentLease(): HumanResumeExecutionLease {
    return this.lease;
  }
}

function sameLeaseBoundary(
  request: HumanResumeExecutionRequest,
  lease: HumanResumeExecutionLease,
): boolean {
  return (
    lease.tenantId === request.command.scope.tenantId &&
    lease.userId === request.command.scope.userId &&
    lease.runId === request.command.runId &&
    lease.nodeId === request.command.expectedNodeId &&
    lease.resolutionId === request.command.resolutionId &&
    lease.state === "ACTIVE"
  );
}

/**
 * Provider-neutral production resume worker. It reconstructs the exact immutable
 * workflow/browser-profile runtime for a validated human resolution and fences every
 * durable checkpoint behind renewal of the human-resume execution lease.
 */
export class HumanResumeWorker implements HumanResumeExecutor {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResumeWorkerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    if (
      !Number.isSafeInteger(dependencies.browserSessionTimeoutSeconds) ||
      dependencies.browserSessionTimeoutSeconds <= 0
    ) {
      throw new Error("browserSessionTimeoutSeconds must be a positive safe integer");
    }
    if (!Number.isSafeInteger(dependencies.leaseTtlMs) || dependencies.leaseTtlMs <= 0) {
      throw new Error("leaseTtlMs must be a positive safe integer");
    }
  }

  async execute(request: HumanResumeExecutionRequest): Promise<ExecutionResult> {
    this.assertRequestBoundary(request);

    const scope = request.command.scope;
    const run = request.validated.run;
    const automation = await this.dependencies.automations.get(scope, run.automationId);
    if (!automation) {
      throw new Error(`automation '${run.automationId}' does not exist in ownership scope`);
    }
    if (automation.status !== "ACTIVE") {
      throw new Error(`automation '${run.automationId}' is not active for human resume`);
    }

    const graph = await this.dependencies.workflows.get(
      scope,
      run.automationId,
      run.workflowVersion,
    );
    if (!graph) {
      throw new Error(`workflow version ${run.workflowVersion} is unavailable for human resume`);
    }
    if (graph.automationId !== run.automationId || graph.version !== run.workflowVersion) {
      throw new Error("human resume workflow identity does not match durable run");
    }

    const profileRef = automation.browserProfileRef;
    if (!profileRef) {
      throw new Error("human resume requires an authorized browser profile");
    }

    let currentLease = request.lease;
    const renewLease = async (
      lease: HumanResumeExecutionLease,
    ): Promise<HumanResumeExecutionLease> => {
      const renewed = await this.dependencies.leases.renew(
        lease,
        this.now().toISOString(),
        this.dependencies.leaseTtlMs,
      );
      if (!renewed) {
        throw new Error("human resume execution lease expired or ownership was lost before renewal");
      }
      currentLease = renewed;
      return renewed;
    };

    // Fence browser/model startup itself, not only later checkpoint writes.
    currentLease = await renewLease(currentLease);
    const renewingCheckpoints = new LeaseRenewingCheckpointRepository(
      this.dependencies.checkpoints,
      currentLease,
      renewLease,
    );

    let session: BrowserSessionHandle | null = null;
    let runtime: BrowserExecutionRuntime | null = null;
    let successProfilePersisted = false;
    let execution: ExecutionResult | null = null;
    let executionError: unknown;
    let profilePersistenceError: unknown;

    try {
      session = await this.dependencies.sessions.start(scope, {
        automationId: run.automationId,
        runId: run.runId,
        profileRef,
        timeoutSeconds: this.dependencies.browserSessionTimeoutSeconds,
      });
      runtime = await this.dependencies.runtimeFactory.create(scope, run, session);

      const finalizingRuns = new FinalizingRunRepository(this.dependencies.runs, {
        beforeSuccess: async () => {
          if (!session) throw new Error("browser session disappeared before human resume finalization");
          await renewLease(renewingCheckpoints.currentLease());
          await this.dependencies.sessions.saveProfile(scope, session, profileRef);
          successProfilePersisted = true;
        },
      });

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

      execution = await engine.execute({
        scope,
        run,
        graph,
        resumeFromHuman: true,
      });
    } catch (error) {
      executionError = error;
    } finally {
      if (session && !successProfilePersisted) {
        try {
          await renewLease(renewingCheckpoints.currentLease());
          await this.dependencies.sessions.saveProfile(scope, session, profileRef);
        } catch (error) {
          profilePersistenceError = error;
        }
      }

      if (runtime) {
        try {
          await runtime.close();
        } catch {
          this.dependencies.onCleanupWarning?.("browser execution runtime cleanup failed");
        }
      }
      if (session) {
        try {
          await this.dependencies.sessions.stop(scope, session);
        } catch {
          this.dependencies.onCleanupWarning?.("browser session cleanup failed");
        }
      }
    }

    if (executionError) throw executionError;
    if (profilePersistenceError) {
      throw new Error("browser profile persistence failed during human resume", {
        cause: profilePersistenceError,
      });
    }
    if (!execution) throw new Error("human resume worker completed without an execution result");
    return execution;
  }

  private assertRequestBoundary(request: HumanResumeExecutionRequest): void {
    if (request.validated.result.status !== "ACCEPTED") {
      throw new Error("human resume worker requires a newly accepted resolution");
    }
    if (!sameLeaseBoundary(request, request.lease)) {
      throw new Error("human resume execution lease does not match the validated resolution boundary");
    }
    const run = request.validated.run;
    const checkpoint = request.validated.checkpoint;
    if (
      run.tenantId !== request.command.scope.tenantId ||
      run.userId !== request.command.scope.userId ||
      run.runId !== request.command.runId ||
      run.status !== "WAITING_FOR_HUMAN"
    ) {
      throw new Error("validated human resume run does not match the command boundary");
    }
    if (
      checkpoint.runId !== run.runId ||
      checkpoint.automationId !== run.automationId ||
      checkpoint.workflowVersion !== run.workflowVersion ||
      checkpoint.currentNodeId !== request.command.expectedNodeId
    ) {
      throw new Error("validated human resume checkpoint does not match the durable run boundary");
    }
  }
}
