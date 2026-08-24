import type { ExecutionResult } from "./execution.js";
import type { HumanResumeAuditEventType, HumanResumeAuditStore } from "./human-resume-audit.js";
import type {
  HumanResolutionCommand,
  HumanResolutionClaimResult,
  HumanResolutionCoordinator,
  ValidatedHumanResolution,
} from "./human-resolution.js";
import type {
  HumanResumeExecutionLease,
  HumanResumeExecutionLeaseAcquireResult,
  HumanResumeExecutionLeaseStore,
} from "./human-resume-lease.js";

export interface HumanResumeExecutionRequest {
  command: HumanResolutionCommand;
  validated: ValidatedHumanResolution;
  lease: HumanResumeExecutionLease;
}

/**
 * Production adapters may open browser/model compute only through this boundary.
 * The executor is invoked only while a newly ACCEPTED resolution owns a durable
 * execution lease for the same tenant/run/node/resolution boundary.
 */
export interface HumanResumeExecutor {
  execute(request: HumanResumeExecutionRequest): Promise<ExecutionResult>;
}

export type HumanResumeOrchestrationResult =
  | {
      kind: "EXECUTED";
      claim: Extract<HumanResolutionClaimResult, { status: "ACCEPTED" }>;
      lease: HumanResumeExecutionLease;
      execution: ExecutionResult;
    }
  | {
      kind: "NOT_EXECUTED";
      claim: Extract<HumanResolutionClaimResult, { status: "REPLAY" | "CONFLICT" }>;
    }
  | {
      kind: "LEASE_NOT_ACQUIRED";
      claim: Extract<HumanResolutionClaimResult, { status: "ACCEPTED" }>;
      lease: Exclude<HumanResumeExecutionLeaseAcquireResult, { status: "ACQUIRED" }>;
    };

export interface HumanResumeOrchestratorDependencies {
  resolutions: HumanResolutionCoordinator;
  leases: HumanResumeExecutionLeaseStore;
  executor: HumanResumeExecutor;
  ownerToken: () => string;
  now?: () => Date;
  leaseTtlMs: number;
  audit?: HumanResumeAuditStore;
  auditEventId?: () => string;
  onAuditWarning?: (warning: string) => void;
}

/**
 * Converts at-least-once human-resolution delivery into guarded resume execution.
 * Claim replay remains non-executing. Newly accepted resolutions must additionally
 * own a durable execution lease before browser/model work begins. Executor failure
 * intentionally leaves that lease active until expiry and does not make claim replay
 * executable; recovery after expiry still requires a separate effect-reconciliation
 * policy before it can safely rerun a side-effecting successor.
 *
 * Audit events are derived observability. They are deliberately best-effort so a
 * telemetry outage cannot turn a safe claim/lease decision into duplicate website
 * execution. Durable claim/lease state remains authoritative.
 */
export class HumanResumeOrchestrator {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResumeOrchestratorDependencies) {
    if (!Number.isSafeInteger(dependencies.leaseTtlMs) || dependencies.leaseTtlMs <= 0) {
      throw new Error("leaseTtlMs must be a positive safe integer");
    }
    if (dependencies.audit && !dependencies.auditEventId) {
      throw new Error("auditEventId is required when human resume audit persistence is configured");
    }
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(command: HumanResolutionCommand): Promise<HumanResumeOrchestrationResult> {
    const validated = await this.dependencies.resolutions.claim(command);
    await this.emitAudit(
      command,
      validated.result.status === "ACCEPTED"
        ? "RESOLUTION_ACCEPTED"
        : validated.result.status === "REPLAY"
          ? "RESOLUTION_REPLAYED"
          : "RESOLUTION_CONFLICTED",
    );
    if (validated.result.status !== "ACCEPTED") {
      return { kind: "NOT_EXECUTED", claim: validated.result };
    }

    const leaseResult = await this.dependencies.leases.acquire(
      command,
      this.dependencies.ownerToken(),
      this.now().toISOString(),
      this.dependencies.leaseTtlMs,
    );
    await this.emitAudit(
      command,
      leaseResult.status === "ACQUIRED" ? "LEASE_ACQUIRED" : "LEASE_NOT_ACQUIRED",
    );
    if (leaseResult.status !== "ACQUIRED") {
      return {
        kind: "LEASE_NOT_ACQUIRED",
        claim: validated.result,
        lease: leaseResult,
      };
    }

    await this.emitAudit(command, "EXECUTION_STARTED");
    let execution: ExecutionResult;
    try {
      execution = await this.dependencies.executor.execute({
        command,
        validated,
        lease: leaseResult.lease,
      });
      await this.emitAudit(command, "EXECUTION_SUCCEEDED");
    } catch (error) {
      await this.emitAudit(command, "EXECUTION_FAILED");
      throw error;
    }

    const completedLease = await this.dependencies.leases.complete(
      leaseResult.lease,
      this.now().toISOString(),
    );
    if (!completedLease) {
      await this.emitAudit(command, "LEASE_COMPLETION_FAILED");
      throw new Error(
        "human resume execution finished after durable execution ownership was lost or expired",
      );
    }
    await this.emitAudit(command, "LEASE_COMPLETED");

    return {
      kind: "EXECUTED",
      claim: validated.result,
      lease: completedLease,
      execution,
    };
  }

  private async emitAudit(
    command: HumanResolutionCommand,
    type: HumanResumeAuditEventType,
  ): Promise<void> {
    const audit = this.dependencies.audit;
    const eventId = this.dependencies.auditEventId;
    if (!audit || !eventId) return;
    try {
      await audit.append({
        eventId: eventId(),
        occurredAt: this.now().toISOString(),
        type,
        tenantId: command.scope.tenantId,
        userId: command.scope.userId,
        runId: command.runId,
        nodeId: command.expectedNodeId,
        resolutionId: command.resolutionId,
      });
    } catch {
      this.dependencies.onAuditWarning?.("human resume audit persistence failed");
    }
  }
}
