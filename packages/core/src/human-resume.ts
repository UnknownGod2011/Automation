import type { ExecutionResult } from "./execution.js";
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
}

/**
 * Converts at-least-once human-resolution delivery into guarded resume execution.
 * Claim replay remains non-executing. Newly accepted resolutions must additionally
 * own a durable execution lease before browser/model work begins. Executor failure
 * intentionally leaves that lease active until expiry and does not make claim replay
 * executable; recovery after expiry still requires a separate effect-reconciliation
 * policy before it can safely rerun a side-effecting successor.
 */
export class HumanResumeOrchestrator {
  private readonly now: () => Date;

  constructor(private readonly dependencies: HumanResumeOrchestratorDependencies) {
    if (!Number.isSafeInteger(dependencies.leaseTtlMs) || dependencies.leaseTtlMs <= 0) {
      throw new Error("leaseTtlMs must be a positive safe integer");
    }
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(command: HumanResolutionCommand): Promise<HumanResumeOrchestrationResult> {
    const validated = await this.dependencies.resolutions.claim(command);
    if (validated.result.status !== "ACCEPTED") {
      return { kind: "NOT_EXECUTED", claim: validated.result };
    }

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
        lease: leaseResult,
      };
    }

    const execution = await this.dependencies.executor.execute({
      command,
      validated,
      lease: leaseResult.lease,
    });
    const completedLease = await this.dependencies.leases.complete(
      leaseResult.lease,
      this.now().toISOString(),
    );
    if (!completedLease) {
      throw new Error(
        "human resume execution finished after durable execution ownership was lost or expired",
      );
    }

    return {
      kind: "EXECUTED",
      claim: validated.result,
      lease: completedLease,
      execution,
    };
  }
}
