import type { RunCheckpoint, WorkflowNode } from "@automation/contracts";
import type {
  AutomationRepository,
  BrowserExecutor,
  BrowserSessionHandle,
  BrowserSessionManager,
  CheckpointRepository,
  ReasoningProvider,
  RunRepository,
  VerificationEngine,
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
import type {
  HumanResumeEffectIdentity,
  HumanResumeEffectReconciliationStore,
} from "./human-resume-effect.js";
import { HumanResumeLeaseHeartbeat } from "./human-resume-heartbeat.js";
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
  effects: HumanResumeEffectReconciliationStore;
  effectId: () => string;
  browserSessionTimeoutSeconds: number;
  leaseTtlMs: number;
  leaseHeartbeatIntervalMs?: number;
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
    private readonly renew: () => Promise<HumanResumeExecutionLease>,
  ) {}

  async get(scope: { tenantId: string; userId: string }, runId: string): Promise<RunCheckpoint | null> {
    return this.delegate.get(scope, runId);
  }

  async put(scope: { tenantId: string; userId: string }, checkpoint: RunCheckpoint): Promise<void> {
    await this.renew();
    await this.delegate.put(scope, checkpoint);
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

function requiredGeneratedId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("human resume effectId generator returned an empty id");
  if (normalized.length > 512) throw new Error("human resume effectId generator returned an oversized id");
  return normalized;
}

function firstHumanSuccessor(graphNode: WorkflowNode | undefined, nodes: Readonly<Record<string, WorkflowNode>>): WorkflowNode {
  if (!graphNode || graphNode.kind !== "HUMAN") {
    throw new Error("human resume durable node is not an explicit HUMAN workflow node");
  }
  const successors = graphNode.next ?? [];
  if (successors.length !== 1 || !successors[0]) {
    throw new Error("human resume requires exactly one declared HUMAN successor");
  }
  const successor = nodes[successors[0]];
  if (!successor) throw new Error(`human resume successor '${successors[0]}' is missing from workflow`);
  return successor;
}

function resumeEffectBoundary(request: HumanResumeExecutionRequest, graphNode: WorkflowNode | undefined, nodes: Readonly<Record<string, WorkflowNode>>): WorkflowNode | null {
  if (!graphNode) throw new Error("human resume durable node is missing from immutable workflow");
  if (graphNode.kind === "HUMAN") return firstHumanSuccessor(graphNode, nodes);
  const failure = request.validated.checkpoint.lastFailure;
  if (
    failure?.code !== "TARGET_AUTH_REQUIRED" ||
    failure.nodeId !== request.command.expectedNodeId
  ) {
    throw new Error("human resume non-HUMAN node is not a target-authentication repair boundary");
  }
  return null;
}

/**
 * Provider-neutral production resume worker. It reconstructs the exact immutable
 * workflow/browser-profile runtime and continuously fences browser/model work behind
 * durable human-resume execution ownership.
 *
 * Explicit HUMAN nodes retain durable first-successor effect reconciliation. A
 * non-HUMAN resume is permitted only after a durable TARGET_AUTH_REQUIRED failure on
 * that exact node, because the repair path restores authentication and retries the
 * same immutable node rather than selecting new control flow.
 */
export class HumanResumeWorker implements HumanResumeExecutor {
  private readonly now: () => Date;
  private readonly heartbeatIntervalMs: number;

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

    this.heartbeatIntervalMs =
      dependencies.leaseHeartbeatIntervalMs ?? Math.max(1, Math.floor(dependencies.leaseTtlMs / 3));
    if (
      !Number.isSafeInteger(this.heartbeatIntervalMs) ||
      this.heartbeatIntervalMs <= 0 ||
      this.heartbeatIntervalMs >= dependencies.leaseTtlMs
    ) {
      throw new Error("leaseHeartbeatIntervalMs must be a positive safe integer smaller than leaseTtlMs");
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
    const firstSuccessor = resumeEffectBoundary(
      request,
      graph.nodes[request.command.expectedNodeId],
      graph.nodes,
    );

    const profileRef = automation.browserProfileRef;
    if (!profileRef) {
      throw new Error("human resume requires an authorized browser profile");
    }

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
      return renewed;
    };

    const heartbeat = new HumanResumeLeaseHeartbeat(
      request.lease,
      renewLease,
      this.heartbeatIntervalMs,
    );

    await heartbeat.renewNow();
    heartbeat.start();
    const renewingCheckpoints = new LeaseRenewingCheckpointRepository(
      this.dependencies.checkpoints,
      () => heartbeat.renewNow(),
    );

    let preparedFirstSuccessorEffect = false;
    let effectIdentity: HumanResumeEffectIdentity | null = null;
    const prepareFirstSuccessorEffect = async (node: WorkflowNode): Promise<void> => {
      if (!firstSuccessor || node.id !== firstSuccessor.id || node.allowedSideEffects.length === 0) return;
      if (preparedFirstSuccessorEffect) return;
      if (!node.verification) {
        throw new Error("side-effecting human resume successor has no verification contract");
      }
      effectIdentity ??= {
        tenantId: scope.tenantId,
        userId: scope.userId,
        runId: run.runId,
        humanNodeId: request.command.expectedNodeId,
        successorNodeId: node.id,
        resolutionId: request.command.resolutionId,
        effectId: requiredGeneratedId(this.dependencies.effectId()),
      };
      const identity = effectIdentity;
      const prepared = await heartbeat.runFenced(() =>
        this.dependencies.effects.prepare(identity, this.now().toISOString()),
      );
      if (prepared.status === "CONFLICT") {
        throw new Error("human resume first-successor effect identity conflicts with durable reconciliation state");
      }
      if (prepared.record.state !== "PREPARED") {
        throw new Error("human resume first-successor effect was already durably reconciled before execution");
      }
      preparedFirstSuccessorEffect = true;
    };

    let session: BrowserSessionHandle | null = null;
    let runtime: BrowserExecutionRuntime | null = null;
    let successProfilePersisted = false;
    let execution: ExecutionResult | null = null;
    let executionError: unknown;
    let profilePersistenceError: unknown;

    try {
      session = await heartbeat.runFenced(() =>
        this.dependencies.sessions.start(scope, {
          automationId: run.automationId,
          runId: run.runId,
          profileRef,
          timeoutSeconds: this.dependencies.browserSessionTimeoutSeconds,
        }),
      );
      const activeSession = session;
      const activeRuntime = await heartbeat.runFenced(() =>
        this.dependencies.runtimeFactory.create(scope, run, activeSession),
      );
      runtime = activeRuntime;

      const fencedBrowser: BrowserExecutor = {
        executeDeterministic: async (actionScope, runId, node, inputs) => {
          await prepareFirstSuccessorEffect(node);
          return heartbeat.runFenced(() =>
            activeRuntime.browser.executeDeterministic(actionScope, runId, node, inputs),
          );
        },
        executeSemantic: async (actionScope, runId, node, decision, inputs) => {
          await prepareFirstSuccessorEffect(node);
          return heartbeat.runFenced(() =>
            activeRuntime.browser.executeSemantic(actionScope, runId, node, decision, inputs),
          );
        },
      };
      const fencedVerifier: VerificationEngine = {
        verify: (context) => heartbeat.runFenced(() => activeRuntime.verifier.verify(context)),
      };
      const fencedReasoner: ReasoningProvider = {
        decide: (reasoningRequest) =>
          heartbeat.runFenced(() => this.dependencies.reasoner.decide(reasoningRequest)),
      };

      const finalizingRuns = new FinalizingRunRepository(this.dependencies.runs, {
        beforeSuccess: async () => {
          if (!session) throw new Error("browser session disappeared before human resume finalization");
          await heartbeat.renewNow();
          await this.dependencies.sessions.saveProfile(scope, session, profileRef);
          heartbeat.assertOwned();
          successProfilePersisted = true;
        },
      });

      const engine = new WorkflowExecutionEngine({
        browser: fencedBrowser,
        reasoner: fencedReasoner,
        verifier: fencedVerifier,
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
      await heartbeat.stop();

      if (session && !successProfilePersisted) {
        try {
          await heartbeat.renewNow();
          await this.dependencies.sessions.saveProfile(scope, session, profileRef);
          heartbeat.assertOwned();
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
