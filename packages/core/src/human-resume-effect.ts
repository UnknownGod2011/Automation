import type { OwnershipScope } from "./index.js";

export type HumanResumeEffectDecision =
  | "ALREADY_APPLIED"
  | "DEFINITELY_NOT_APPLIED"
  | "AMBIGUOUS";

export type HumanResumeEffectState = "PREPARED" | "DECIDED";

export interface HumanResumeEffectIdentity {
  tenantId: string;
  userId: string;
  runId: string;
  humanNodeId: string;
  successorNodeId: string;
  resolutionId: string;
  effectId: string;
}

export interface HumanResumeEffectRecord extends HumanResumeEffectIdentity {
  state: HumanResumeEffectState;
  preparedAt: string;
  decision?: HumanResumeEffectDecision;
  decidedAt?: string;
}

export type HumanResumeEffectPrepareResult =
  | { status: "PREPARED" | "REPLAY"; record: HumanResumeEffectRecord }
  | { status: "CONFLICT"; record: HumanResumeEffectRecord };

export type HumanResumeEffectDecideResult =
  | { status: "DECIDED" | "REPLAY"; record: HumanResumeEffectRecord }
  | { status: "CONFLICT"; record: HumanResumeEffectRecord };

/**
 * Durable authority for the unknown-side-effect window immediately after human
 * resume. Production implementations must atomically create one immutable effect
 * identity for a pause boundary and atomically persist exactly one reconciliation
 * decision. Storage uncertainty must propagate rather than be guessed.
 */
export interface HumanResumeEffectReconciliationStore {
  prepare(
    identity: HumanResumeEffectIdentity,
    preparedAt: string,
  ): Promise<HumanResumeEffectPrepareResult>;
  decide(
    identity: HumanResumeEffectIdentity,
    decision: HumanResumeEffectDecision,
    decidedAt: string,
  ): Promise<HumanResumeEffectDecideResult>;
  get(
    scope: OwnershipScope,
    runId: string,
    humanNodeId: string,
  ): Promise<HumanResumeEffectRecord | null>;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

function instant(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return parsed.toISOString();
}

function normalizedIdentity(identity: HumanResumeEffectIdentity): HumanResumeEffectIdentity {
  return {
    tenantId: required(identity.tenantId, "tenantId"),
    userId: required(identity.userId, "userId"),
    runId: required(identity.runId, "runId"),
    humanNodeId: required(identity.humanNodeId, "humanNodeId"),
    successorNodeId: required(identity.successorNodeId, "successorNodeId"),
    resolutionId: required(identity.resolutionId, "resolutionId"),
    effectId: required(identity.effectId, "effectId"),
  };
}

function sameIdentity(a: HumanResumeEffectIdentity, b: HumanResumeEffectIdentity): boolean {
  return (
    a.tenantId === b.tenantId &&
    a.userId === b.userId &&
    a.runId === b.runId &&
    a.humanNodeId === b.humanNodeId &&
    a.successorNodeId === b.successorNodeId &&
    a.resolutionId === b.resolutionId &&
    a.effectId === b.effectId
  );
}

function key(scope: OwnershipScope, runId: string, humanNodeId: string): string {
  return `${required(scope.tenantId, "tenantId")}\u0000${required(scope.userId, "userId")}\u0000${required(runId, "runId")}\u0000${required(humanNodeId, "humanNodeId")}`;
}

function assertDecision(decision: HumanResumeEffectDecision): HumanResumeEffectDecision {
  if (
    decision !== "ALREADY_APPLIED" &&
    decision !== "DEFINITELY_NOT_APPLIED" &&
    decision !== "AMBIGUOUS"
  ) {
    throw new Error("invalid human resume effect reconciliation decision");
  }
  return decision;
}

export function humanResumeEffectRetryAllowed(decision: HumanResumeEffectDecision): boolean {
  return decision === "DEFINITELY_NOT_APPLIED";
}

export class InMemoryHumanResumeEffectReconciliationStore
  implements HumanResumeEffectReconciliationStore
{
  private readonly records = new Map<string, HumanResumeEffectRecord>();

  async prepare(
    identity: HumanResumeEffectIdentity,
    preparedAt: string,
  ): Promise<HumanResumeEffectPrepareResult> {
    const normalized = normalizedIdentity(identity);
    const recordKey = key(normalized, normalized.runId, normalized.humanNodeId);
    const existing = this.records.get(recordKey);
    if (existing) {
      return sameIdentity(existing, normalized)
        ? { status: "REPLAY", record: structuredClone(existing) }
        : { status: "CONFLICT", record: structuredClone(existing) };
    }

    const record: HumanResumeEffectRecord = {
      ...normalized,
      state: "PREPARED",
      preparedAt: instant(preparedAt, "preparedAt"),
    };
    this.records.set(recordKey, structuredClone(record));
    return { status: "PREPARED", record };
  }

  async decide(
    identity: HumanResumeEffectIdentity,
    decision: HumanResumeEffectDecision,
    decidedAt: string,
  ): Promise<HumanResumeEffectDecideResult> {
    const normalized = normalizedIdentity(identity);
    const recordKey = key(normalized, normalized.runId, normalized.humanNodeId);
    const existing = this.records.get(recordKey);
    if (!existing) throw new Error("human resume effect must be prepared before reconciliation");
    if (!sameIdentity(existing, normalized)) {
      return { status: "CONFLICT", record: structuredClone(existing) };
    }

    const normalizedDecision = assertDecision(decision);
    if (existing.state === "DECIDED") {
      return existing.decision === normalizedDecision
        ? { status: "REPLAY", record: structuredClone(existing) }
        : { status: "CONFLICT", record: structuredClone(existing) };
    }

    const record: HumanResumeEffectRecord = {
      ...existing,
      state: "DECIDED",
      decision: normalizedDecision,
      decidedAt: instant(decidedAt, "decidedAt"),
    };
    this.records.set(recordKey, structuredClone(record));
    return { status: "DECIDED", record };
  }

  async get(
    scope: OwnershipScope,
    runId: string,
    humanNodeId: string,
  ): Promise<HumanResumeEffectRecord | null> {
    const record = this.records.get(key(scope, runId, humanNodeId));
    return record ? structuredClone(record) : null;
  }
}
