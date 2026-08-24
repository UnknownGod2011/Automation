import type { OwnershipScope } from "./index.js";

export type HumanResumeAuditEventType =
  | "RESOLUTION_ACCEPTED"
  | "RESOLUTION_REPLAYED"
  | "RESOLUTION_CONFLICTED"
  | "LEASE_ACQUIRED"
  | "LEASE_NOT_ACQUIRED"
  | "EXECUTION_STARTED"
  | "EXECUTION_SUCCEEDED"
  | "EXECUTION_FAILED"
  | "LEASE_COMPLETED"
  | "LEASE_COMPLETION_FAILED";

const HUMAN_RESUME_AUDIT_EVENT_TYPES = new Set<HumanResumeAuditEventType>([
  "RESOLUTION_ACCEPTED",
  "RESOLUTION_REPLAYED",
  "RESOLUTION_CONFLICTED",
  "LEASE_ACQUIRED",
  "LEASE_NOT_ACQUIRED",
  "EXECUTION_STARTED",
  "EXECUTION_SUCCEEDED",
  "EXECUTION_FAILED",
  "LEASE_COMPLETED",
  "LEASE_COMPLETION_FAILED",
]);

export interface HumanResumeAuditEvent {
  eventId: string;
  occurredAt: string;
  type: HumanResumeAuditEventType;
  tenantId: string;
  userId: string;
  runId: string;
  nodeId: string;
  resolutionId: string;
}

/**
 * Append-only, redacted observability boundary for the human-resume lifecycle.
 * The schema intentionally has no arbitrary metadata field so browser state,
 * provider secrets, DOM values, lease owner tokens, or exception text cannot be
 * accidentally persisted through this interface.
 */
export interface HumanResumeAuditStore {
  append(event: HumanResumeAuditEvent): Promise<void>;
  listForRun(scope: OwnershipScope, runId: string): Promise<readonly HumanResumeAuditEvent[]>;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

export function assertHumanResumeAuditEvent(event: HumanResumeAuditEvent): HumanResumeAuditEvent {
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("human resume audit occurredAt must be an ISO-8601 timestamp");
  }
  if (!HUMAN_RESUME_AUDIT_EVENT_TYPES.has(event.type)) {
    throw new Error("human resume audit event type is invalid");
  }
  return {
    eventId: required(event.eventId, "human resume audit eventId"),
    occurredAt: occurredAt.toISOString(),
    type: event.type,
    tenantId: required(event.tenantId, "human resume audit tenantId"),
    userId: required(event.userId, "human resume audit userId"),
    runId: required(event.runId, "human resume audit runId"),
    nodeId: required(event.nodeId, "human resume audit nodeId"),
    resolutionId: required(event.resolutionId, "human resume audit resolutionId"),
  };
}
