import type { HumanResolutionCommand, HumanResolutionClaimResult, ValidatedHumanResolution } from "./human-resolution.js";
import type {
  HumanResumeEffectRecord,
  HumanResumeEffectReconciliationStore,
} from "./human-resume-effect.js";
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
