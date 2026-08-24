import type { HumanResolutionCommand, OwnershipScope } from "./index.js";

export type HumanResumeExecutionLeaseState = "ACTIVE" | "COMPLETED";

export interface HumanResumeExecutionLease {
  tenantId: string;
  userId: string;
  runId: string;
  nodeId: string;
  resolutionId: string;
  ownerToken: string;
  state: HumanResumeExecutionLeaseState;
  acquiredAt: string;
  expiresAt: string;
  completedAt?: string;
}

export type HumanResumeExecutionLeaseAcquireResult =
  | { status: "ACQUIRED"; lease: HumanResumeExecutionLease }
  | { status: "BUSY" | "COMPLETED" | "CONFLICT"; lease: HumanResumeExecutionLease };

/**
 * Durable execution ownership is intentionally separate from the immutable human
 * resolution claim. Production implementations must acquire/renew/complete with
 * atomic compare-and-set semantics; an expired lease may be reacquired only by the
 * same resolution id. A competing resolution id can never acquire execution.
 */
export interface HumanResumeExecutionLeaseStore {
  acquire(
    command: HumanResolutionCommand,
    ownerToken: string,
    acquiredAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLeaseAcquireResult>;
  renew(
    lease: HumanResumeExecutionLease,
    renewedAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLease | null>;
  complete(
    lease: HumanResumeExecutionLease,
    completedAt: string,
  ): Promise<HumanResumeExecutionLease | null>;
  get(
    scope: OwnershipScope,
    runId: string,
    nodeId: string,
  ): Promise<HumanResumeExecutionLease | null>;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

function instant(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return parsed;
}

function positiveTtl(ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be a positive safe integer");
  return ttlMs;
}

function key(scope: OwnershipScope, runId: string, nodeId: string): string {
  return `${required(scope.tenantId, "tenantId")}\u0000${required(scope.userId, "userId")}\u0000${required(runId, "runId")}\u0000${required(nodeId, "nodeId")}`;
}

export class InMemoryHumanResumeExecutionLeaseStore implements HumanResumeExecutionLeaseStore {
  private readonly leases = new Map<string, HumanResumeExecutionLease>();

  async acquire(
    command: HumanResolutionCommand,
    ownerToken: string,
    acquiredAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLeaseAcquireResult> {
    const normalizedOwner = required(ownerToken, "ownerToken");
    const acquired = instant(acquiredAt, "acquiredAt");
    const ttl = positiveTtl(ttlMs);
    const leaseKey = key(command.scope, command.runId, command.expectedNodeId);
    const resolutionId = required(command.resolutionId, "resolutionId");
    const existing = this.leases.get(leaseKey);

    if (existing) {
      if (existing.resolutionId !== resolutionId) {
        return { status: "CONFLICT", lease: structuredClone(existing) };
      }
      if (existing.state === "COMPLETED") {
        return { status: "COMPLETED", lease: structuredClone(existing) };
      }
      if (new Date(existing.expiresAt).getTime() > acquired.getTime()) {
        return { status: "BUSY", lease: structuredClone(existing) };
      }
    }

    const lease: HumanResumeExecutionLease = {
      tenantId: required(command.scope.tenantId, "tenantId"),
      userId: required(command.scope.userId, "userId"),
      runId: required(command.runId, "runId"),
      nodeId: required(command.expectedNodeId, "expectedNodeId"),
      resolutionId,
      ownerToken: normalizedOwner,
      state: "ACTIVE",
      acquiredAt: acquired.toISOString(),
      expiresAt: new Date(acquired.getTime() + ttl).toISOString(),
    };
    this.leases.set(leaseKey, structuredClone(lease));
    return { status: "ACQUIRED", lease };
  }

  async renew(
    lease: HumanResumeExecutionLease,
    renewedAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLease | null> {
    const renewed = instant(renewedAt, "renewedAt");
    const current = this.leases.get(key(lease, lease.runId, lease.nodeId));
    if (
      !current ||
      current.state !== "ACTIVE" ||
      current.ownerToken !== lease.ownerToken ||
      current.resolutionId !== lease.resolutionId ||
      new Date(current.expiresAt).getTime() <= renewed.getTime()
    ) {
      return null;
    }
    const next = {
      ...current,
      expiresAt: new Date(renewed.getTime() + positiveTtl(ttlMs)).toISOString(),
    };
    this.leases.set(key(lease, lease.runId, lease.nodeId), structuredClone(next));
    return structuredClone(next);
  }

  async complete(
    lease: HumanResumeExecutionLease,
    completedAt: string,
  ): Promise<HumanResumeExecutionLease | null> {
    const completed = instant(completedAt, "completedAt");
    const leaseKey = key(lease, lease.runId, lease.nodeId);
    const current = this.leases.get(leaseKey);
    if (
      !current ||
      current.state !== "ACTIVE" ||
      current.ownerToken !== lease.ownerToken ||
      current.resolutionId !== lease.resolutionId ||
      new Date(current.expiresAt).getTime() <= completed.getTime()
    ) {
      return null;
    }
    const next: HumanResumeExecutionLease = {
      ...current,
      state: "COMPLETED",
      completedAt: completed.toISOString(),
    };
    this.leases.set(leaseKey, structuredClone(next));
    return structuredClone(next);
  }

  async get(scope: OwnershipScope, runId: string, nodeId: string): Promise<HumanResumeExecutionLease | null> {
    const value = this.leases.get(key(scope, runId, nodeId));
    return value ? structuredClone(value) : null;
  }
}
