import type { RunCheckpoint, RunRecord, WorkflowNode } from "@automation/contracts";
import type {
  AutomationRepository,
  BrowserSessionHandle,
  BrowserSessionManager,
  OwnershipScope,
  WorkflowVersionRepository,
} from "./index.js";
import type { HumanResolutionCommand, HumanResolutionClaimResult, ValidatedHumanResolution } from "./human-resolution.js";
import type {
  HumanResumeEffectIdentity,
  HumanResumeEffectRecord,
  HumanResumeEffectReconciliationStore,
} from "./human-resume-effect.js";
import {
  HumanResumeEffectReconciler,
  type HumanResumeEffectReconciliationResult,
  type HumanResumeEffectVerifier,
} from "./human-resume-reconciliation.js";
import { HumanResumeLeaseHeartbeat } from "./human-resume-heartbeat.js";
import type {
  HumanResumeExecutionLease,
  HumanResumeExecutionLeaseAcquireResult,
  HumanResumeExecutionLeaseStore,
} from "./human-resume-lease.js";

export interface HumanResumeRecoveryResolutionCoordinator {
  claim(command: HumanResolutionCommand): Promise<ValidatedHumanResolution>;
}

export type HumanResumeRecoveryAdmissionResult =
  | {
      kind: "FRESH_RESOLUTION";
      claim: Extract<HumanResolutionClaimResult, { status: "ACCEPTED" }>;
    }
  | {
      kind: "CLAIM_CONFLICT";
      claim: Extract<HumanResolutionClaimResult, { status: "CONFLICT" }>;
    }
  | {
      kind: "NO_EFFECT_PREPARED";
      claim: Extract<HumanResolutionClaimResult, { status: "REPLAY" }>;
    }
  | {
      kind: "LEASE_NOT_ACQUIRED";
      claim: Extract<HumanResolutionClaimResult, { status: "REPLAY" }>;
      effect: HumanResumeEffectRecord;
      lease: Exclude<HumanResumeExecutionLeaseAcquireResult, { status: "ACQUIRED" }>;
    }
  | {
      kind: "RECONCILIATION_OWNERSHIP_ACQUIRED";
      claim: Extract<HumanResolutionClaimResult, { status: "REPLAY" }>;
      validated: ValidatedHumanResolution;
      effect: HumanResumeEffectRecord;
      lease: HumanResumeExecutionLease;
    };

export interface HumanResumeRecoveryAdmissionDependencies {
  resolutions: HumanResumeRecoveryResolutionCoordinator;
  effects: HumanResumeEffectReconciliationStore;
  leases: HumanResumeExecutionLeaseStore;
  ownerToken: () => string;
  leaseTtlMs: number;
  now?: () => Date;
}

function sameBoundary(command: HumanResolutionCommand, effect: HumanResumeEffectRecord): boolean {
  return (
    effect.tenantId === command.scope.tenantId &&
    effect.userId === command.scope.userId &&
    effect.runId === command.runId &&
    effect.humanNodeId === command.expectedNodeId &&
    effect.resolutionId === command.resolutionId
  );
}

function assertEffectRecord(record: HumanResumeEffectRecord): void {
  if (record.state === "PREPARED") {
    if (record.decision !== undefined || record.decidedAt !== undefined) {
      throw new Error("prepared human resume effect contains an impossible durable decision");
    }
    return;
  }
  if (record.state !== "DECIDED" || !record.decision || !record.decidedAt) {
    throw new Error("decided human resume effect is missing durable decision metadata");
  }
}

/**
 * Provider-neutral admission boundary for crash recovery after an accepted human
 * resolution has already been delivered once.
 *
 * This is intentionally not execution permission. A claim replay may reacquire an
 * expired same-resolution lease only when a durable first-successor effect identity
 * already exists and exactly matches the paused ownership boundary. The returned
 * lease grants ownership for observation/reconciliation work only; callers must not
 * route it to HumanResumeWorker or any external-action executor.
 */
export class HumanResumeRecoveryAdmission {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResumeRecoveryAdmissionDependencies) {
    if (!Number.isSafeInteger(dependencies.leaseTtlMs) || dependencies.leaseTtlMs <= 0) {
      throw new Error("leaseTtlMs must be a positive safe integer");
    }
    this.now = dependencies.now ?? (() => new Date());
  }

  async admit(command: HumanResolutionCommand): Promise<HumanResumeRecoveryAdmissionResult> {
    const validated = await this.dependencies.resolutions.claim(command);

    if (validated.result.status === "ACCEPTED") {
      return { kind: "FRESH_RESOLUTION", claim: validated.result };
    }
    if (validated.result.status === "CONFLICT") {
      return { kind: "CLAIM_CONFLICT", claim: validated.result };
    }

    const effect = await this.dependencies.effects.get(
      command.scope,
      command.runId,
      command.expectedNodeId,
    );
    if (!effect) {
      return { kind: "NO_EFFECT_PREPARED", claim: validated.result };
    }
    if (!sameBoundary(command, effect)) {
      throw new Error("human resume recovery effect does not match replayed resolution boundary");
    }
    assertEffectRecord(effect);

    const leaseResult = await this.dependencies.leases.acquire(
      command,
      this.dependencies.ownerToken(),
      this.now().toISOString(),
      this.dependencies.leaseTtlMs,
    );
    if (leaseResult.status !== "ACQUIRED") {
      return {
        kind: "LEASE_NOT_ACQUIRED",
        claim: validated.result,
        effect,
        lease: leaseResult,
      };
    }

    return {
      kind: "RECONCILIATION_OWNERSHIP_ACQUIRED",
      claim: validated.result,
      validated,
      effect,
      lease: leaseResult.lease,
    };
  }
}

export interface HumanResumeReconciliationRuntime {
  verifier: HumanResumeEffectVerifier;
  close(): Promise<void>;
}

/**
 * Deliberately separate from BrowserExecutionRuntimeFactory: recovery reconciliation
 * must not receive BrowserExecutor or reasoning capabilities.
 */
export interface HumanResumeReconciliationRuntimeFactory {
  create(
    scope: OwnershipScope,
    run: RunRecord,
    session: BrowserSessionHandle,
  ): Promise<HumanResumeReconciliationRuntime>;
}

export type HumanResumeRecoveryExecutionRequest = Extract<
  HumanResumeRecoveryAdmissionResult,
  { kind: "RECONCILIATION_OWNERSHIP_ACQUIRED" }
>;

export interface HumanResumeRecoveryWorkerResult {
  reconciliation: HumanResumeEffectReconciliationResult;
  lease: HumanResumeExecutionLease;
}

export interface HumanResumeRecoveryWorkerDependencies {
  automations: AutomationRepository;
  workflows: WorkflowVersionRepository;
  sessions: BrowserSessionManager;
  runtimeFactory: HumanResumeReconciliationRuntimeFactory;
  effects: HumanResumeEffectReconciliationStore;
  leases: HumanResumeExecutionLeaseStore;
  browserSessionTimeoutSeconds: number;
  leaseTtlMs: number;
  leaseHeartbeatIntervalMs?: number;
  now?: () => Date;
  onCleanupWarning?: (warning: string) => void;
}

function sameLeaseBoundary(
  request: HumanResumeRecoveryExecutionRequest,
  lease: HumanResumeExecutionLease,
): boolean {
  return (
    lease.tenantId === request.claim.claim.tenantId &&
    lease.userId === request.claim.claim.userId &&
    lease.runId === request.claim.claim.runId &&
    lease.nodeId === request.claim.claim.nodeId &&
    lease.resolutionId === request.claim.claim.resolutionId &&
    lease.state === "ACTIVE"
  );
}

function assertValidatedRecoveryBoundary(request: HumanResumeRecoveryExecutionRequest): void {
  if (request.validated.result.status !== "REPLAY") {
    throw new Error("human resume recovery worker requires a replayed resolution");
  }
  if (!sameLeaseBoundary(request, request.lease)) {
    throw new Error("human resume recovery lease does not match replayed resolution boundary");
  }
  assertEffectRecord(request.effect);
  const run = request.validated.run;
  const checkpoint = request.validated.checkpoint;
  const claim = request.claim.claim;
  if (
    run.tenantId !== claim.tenantId ||
    run.userId !== claim.userId ||
    run.runId !== claim.runId ||
    run.status !== "WAITING_FOR_HUMAN" ||
    run.currentNodeId !== claim.nodeId
  ) {
    throw new Error("human resume recovery run does not match replayed resolution boundary");
  }
  if (
    checkpoint.runId !== run.runId ||
    checkpoint.automationId !== run.automationId ||
    checkpoint.workflowVersion !== run.workflowVersion ||
    checkpoint.currentNodeId !== claim.nodeId
  ) {
    throw new Error("human resume recovery checkpoint does not match durable run boundary");
  }
  if (
    request.effect.tenantId !== claim.tenantId ||
    request.effect.userId !== claim.userId ||
    request.effect.runId !== claim.runId ||
    request.effect.humanNodeId !== claim.nodeId ||
    request.effect.resolutionId !== claim.resolutionId
  ) {
    throw new Error("human resume recovery effect does not match replayed resolution boundary");
  }
}

function recoverySuccessor(
  node: WorkflowNode | undefined,
  nodes: Readonly<Record<string, WorkflowNode>>,
  effect: HumanResumeEffectRecord,
): WorkflowNode {
  if (!node || node.kind !== "HUMAN") {
    throw new Error("human resume recovery durable node is not an explicit HUMAN node");
  }
  const successors = node.next ?? [];
  if (successors.length !== 1 || !successors[0]) {
    throw new Error("human resume recovery requires exactly one declared HUMAN successor");
  }
  if (successors[0] !== effect.successorNodeId) {
    throw new Error("human resume recovery effect successor does not match immutable workflow");
  }
  const successor = nodes[successors[0]];
  if (!successor) throw new Error(`human resume recovery successor '${successors[0]}' is missing from workflow`);
  return successor;
}

/**
 * Reconstructs an observation-only runtime after same-resolution crash recovery.
 * Every ownership-sensitive operation is fenced by the replacement lease heartbeat.
 * The worker can inspect and persist reconciliation authority, but it cannot execute
 * or retry the workflow action and it deliberately does not persist browser-profile
 * changes from an observation-only session.
 */
export class HumanResumeRecoveryWorker {
  private readonly now: () => Date;
  private readonly heartbeatIntervalMs: number;

  constructor(private readonly dependencies: HumanResumeRecoveryWorkerDependencies) {
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

  async execute(request: HumanResumeRecoveryExecutionRequest): Promise<HumanResumeRecoveryWorkerResult> {
    assertValidatedRecoveryBoundary(request);
    const claim = request.claim.claim;
    const scope = { tenantId: claim.tenantId, userId: claim.userId };
    const run = request.validated.run;

    const automation = await this.dependencies.automations.get(scope, run.automationId);
    if (!automation) throw new Error(`automation '${run.automationId}' does not exist in ownership scope`);
    if (automation.status !== "ACTIVE") {
      throw new Error(`automation '${run.automationId}' is not active for human resume recovery`);
    }
    const graph = await this.dependencies.workflows.get(scope, run.automationId, run.workflowVersion);
    if (!graph) throw new Error(`workflow version ${run.workflowVersion} is unavailable for human resume recovery`);
    if (graph.automationId !== run.automationId || graph.version !== run.workflowVersion) {
      throw new Error("human resume recovery workflow identity does not match durable run");
    }
    const successor = recoverySuccessor(graph.nodes[claim.nodeId], graph.nodes, request.effect);

    const profileRef = automation.browserProfileRef;
    if (!profileRef) throw new Error("human resume recovery requires an authorized browser profile");

    const renewLease = async (lease: HumanResumeExecutionLease): Promise<HumanResumeExecutionLease> => {
      const renewed = await this.dependencies.leases.renew(
        lease,
        this.now().toISOString(),
        this.dependencies.leaseTtlMs,
      );
      if (!renewed) throw new Error("human resume recovery lease expired or ownership was lost before renewal");
      return renewed;
    };
    const heartbeat = new HumanResumeLeaseHeartbeat(
      request.lease,
      renewLease,
      this.heartbeatIntervalMs,
    );

    let session: BrowserSessionHandle | null = null;
    let runtime: HumanResumeReconciliationRuntime | null = null;
    try {
      await heartbeat.renewNow();
      heartbeat.start();
      session = await heartbeat.runFenced(() =>
        this.dependencies.sessions.start(scope, {
          automationId: run.automationId,
          runId: run.runId,
          profileRef,
          timeoutSeconds: this.dependencies.browserSessionTimeoutSeconds,
        }),
      );
      const activeSession = session;
      runtime = await heartbeat.runFenced(() =>
        this.dependencies.runtimeFactory.create(scope, run, activeSession),
      );
      const activeRuntime = runtime;

      const fencedStore: HumanResumeEffectReconciliationStore = {
        prepare: (identity, preparedAt) =>
          heartbeat.runFenced(() => this.dependencies.effects.prepare(identity, preparedAt)),
        decide: (identity, decision, decidedAt) =>
          heartbeat.runFenced(() => this.dependencies.effects.decide(identity, decision, decidedAt)),
        get: (recordScope, runId, humanNodeId) =>
          heartbeat.runFenced(() => this.dependencies.effects.get(recordScope, runId, humanNodeId)),
      };
      const fencedVerifier: HumanResumeEffectVerifier = {
        inspect: (context) => heartbeat.runFenced(() => activeRuntime.verifier.inspect(context)),
      };
      const reconciler = new HumanResumeEffectReconciler({
        store: fencedStore,
        verifier: fencedVerifier,
        now: this.now,
      });
      const identity: HumanResumeEffectIdentity = {
        tenantId: request.effect.tenantId,
        userId: request.effect.userId,
        runId: request.effect.runId,
        humanNodeId: request.effect.humanNodeId,
        successorNodeId: request.effect.successorNodeId,
        resolutionId: request.effect.resolutionId,
        effectId: request.effect.effectId,
      };
      const reconciliation = await reconciler.reconcile(identity, successor);
      heartbeat.assertOwned();
      return { reconciliation, lease: heartbeat.currentLease() };
    } finally {
      await heartbeat.stop();
      if (runtime) {
        try {
          await runtime.close();
        } catch {
          this.dependencies.onCleanupWarning?.("human resume reconciliation runtime cleanup failed");
        }
      }
      if (session) {
        try {
          await this.dependencies.sessions.stop(scope, session);
        } catch {
          this.dependencies.onCleanupWarning?.("human resume reconciliation browser session cleanup failed");
        }
      }
    }
  }
}
