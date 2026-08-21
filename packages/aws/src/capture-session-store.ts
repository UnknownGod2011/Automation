import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { CaptureSessionRecord, CaptureSessionStore, OwnershipScope } from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const CAPTURE_PREFIX = "CAPTURE#";
const CAPTURE_LATEST_PREFIX = "CAPTURE_LATEST#";
const CAPTURE_CURRENT_PREFIX = "CAPTURE_CURRENT#";
type CaptureDynamoCommand = GetCommand | TransactWriteCommand;

export interface CaptureDynamoClientLike {
  send(command: CaptureDynamoCommand): Promise<Record<string, unknown>>;
}

function scopePk(scope: OwnershipScope): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "capture-sessions"));
  return `SCOPE#${digest.slice(0, 32)}`;
}
function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  if (trimmed.length > 512) throw new Error(`${name} is too long`);
  return encodeURIComponent(trimmed);
}
function sessionSk(captureSessionId: string): string { return `${CAPTURE_PREFIX}${token(captureSessionId, "captureSessionId")}`; }
function latestSk(automationId: string): string { return `${CAPTURE_LATEST_PREFIX}${token(automationId, "automationId")}`; }
function currentSk(automationId: string): string { return `${CAPTURE_CURRENT_PREFIX}${token(automationId, "automationId")}`; }
function conditionalFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = String((error as { name?: unknown }).name);
  return name === "ConditionalCheckFailedException" || name === "TransactionCanceledException";
}
function parseRecord(scope: OwnershipScope, item: Record<string, unknown> | undefined): CaptureSessionRecord | null {
  if (!item) return null;
  if (item.entity !== "CaptureSession") throw new Error("DynamoDB capture-session entity mismatch");
  const record = item.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("DynamoDB capture session has no record payload");
  const value = structuredClone(record as CaptureSessionRecord);
  if (value.tenantId !== scope.tenantId || value.userId !== scope.userId) throw new Error("DynamoDB capture session ownership mismatch");
  return value;
}

export class AwsDynamoCaptureSessionStore implements CaptureSessionStore {
  constructor(private readonly client: CaptureDynamoClientLike, private readonly tableName: string) {
    if (!tableName.trim()) throw new Error("capture-session DynamoDB tableName is required");
  }

  async putStarted(record: CaptureSessionRecord): Promise<void> {
    if (record.status !== "STARTED" || record.traceId || record.completedAt) throw new Error("new capture session must be STARTED without completion metadata");
    const scope = { tenantId: record.tenantId, userId: record.userId };
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: { pk: scopePk(scope), sk: sessionSk(record.captureSessionId), entity: "CaptureSession", record: structuredClone(record) }, ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" } },
        { Put: { TableName: this.tableName, Item: { pk: scopePk(scope), sk: currentSk(record.automationId), entity: "CaptureSessionCurrent", automationId: record.automationId, captureSessionId: record.captureSessionId, startedAt: record.startedAt } } },
      ],
    }));
  }

  async get(scope: OwnershipScope, captureSessionId: string): Promise<CaptureSessionRecord | null> {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk: scopePk(scope), sk: sessionSk(captureSessionId) }, ConsistentRead: true }));
    return parseRecord(scope, response.Item as Record<string, unknown> | undefined);
  }

  async activeForAutomation(scope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null> {
    const pointer = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk: scopePk(scope), sk: currentSk(automationId) }, ConsistentRead: true }));
    const item = pointer.Item as Record<string, unknown> | undefined;
    if (!item) return null;
    if (item.entity !== "CaptureSessionCurrent" || item.automationId !== automationId || typeof item.captureSessionId !== "string") {
      throw new Error("DynamoDB current capture pointer is invalid");
    }
    const record = await this.get(scope, item.captureSessionId);
    if (!record || record.automationId !== automationId) throw new Error("DynamoDB current capture pointer is inconsistent");
    return record.status === "STARTED" ? record : null;
  }

  async complete(scope: OwnershipScope, captureSessionId: string, traceId: string, completedAt: string): Promise<"COMPLETED" | "REPLAY"> {
    const existing = await this.get(scope, captureSessionId);
    if (!existing) throw new Error("capture session not found");
    if (existing.status === "COMPLETED") {
      if (existing.traceId !== traceId) throw new Error("capture session completion conflict");
      return "REPLAY";
    }
    const completed: CaptureSessionRecord = { ...existing, status: "COMPLETED", traceId, completedAt };
    try {
      await this.client.send(new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: { pk: scopePk(scope), sk: sessionSk(captureSessionId), entity: "CaptureSession", record: structuredClone(completed) }, ConditionExpression: "#record.#status = :started", ExpressionAttributeNames: { "#record": "record", "#status": "status" }, ExpressionAttributeValues: { ":started": "STARTED" } } },
          { Put: { TableName: this.tableName, Item: { pk: scopePk(scope), sk: latestSk(existing.automationId), entity: "CaptureSessionLatest", captureSessionId, traceId, completedAt } } },
        ],
      }));
      return "COMPLETED";
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      const winner = await this.get(scope, captureSessionId);
      if (winner?.status === "COMPLETED" && winner.traceId === traceId) return "REPLAY";
      throw new Error("capture session completion conflict");
    }
  }

  async latestCompletedForAutomation(scope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null> {
    const pointer = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { pk: scopePk(scope), sk: latestSk(automationId) }, ConsistentRead: true }));
    const item = pointer.Item as Record<string, unknown> | undefined;
    if (!item) return null;
    if (item.entity !== "CaptureSessionLatest" || typeof item.captureSessionId !== "string") throw new Error("DynamoDB latest capture pointer is invalid");
    const record = await this.get(scope, item.captureSessionId);
    if (!record || record.automationId !== automationId || record.status !== "COMPLETED") throw new Error("DynamoDB latest capture pointer is inconsistent");
    return record;
  }
}
