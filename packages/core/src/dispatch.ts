import type { OwnershipScope } from "./index.js";

export interface ScheduledDispatchEnvelope {
  schemaVersion: 1;
  scope: OwnershipScope;
  automationId: string;
  scheduleId: string;
  scheduledAt: string;
  deliveryId: string;
}

export type ScheduledExecutionStartResult =
  | { kind: "STARTED"; executionRef: string }
  | { kind: "DUPLICATE"; executionRef: string };

export interface ScheduledExecutionStarter {
  start(envelope: ScheduledDispatchEnvelope): Promise<ScheduledExecutionStartResult>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function parseScheduledDispatchEnvelope(value: unknown): ScheduledDispatchEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scheduled dispatch payload must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("unsupported scheduled dispatch schema version");
  const scopeValue = record.scope;
  if (!scopeValue || typeof scopeValue !== "object" || Array.isArray(scopeValue)) {
    throw new Error("scheduled dispatch scope is required");
  }
  const scopeRecord = scopeValue as Record<string, unknown>;
  const scheduledAt = requireString(record.scheduledAt, "scheduledAt");
  const instant = new Date(scheduledAt);
  if (Number.isNaN(instant.getTime())) throw new Error("scheduledAt must be an ISO-8601 timestamp");

  return {
    schemaVersion: 1,
    scope: {
      tenantId: requireString(scopeRecord.tenantId, "tenantId"),
      userId: requireString(scopeRecord.userId, "userId"),
    },
    automationId: requireString(record.automationId, "automationId"),
    scheduleId: requireString(record.scheduleId, "scheduleId"),
    scheduledAt: instant.toISOString(),
    deliveryId: requireString(record.deliveryId, "deliveryId"),
  };
}

export class ScheduledDispatchService {
  constructor(private readonly starter: ScheduledExecutionStarter) {}

  async handle(value: unknown): Promise<ScheduledExecutionStartResult> {
    return this.starter.start(parseScheduledDispatchEnvelope(value));
  }
}
