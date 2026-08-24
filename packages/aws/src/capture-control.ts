import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type {
  CaptureCollectionControlRecord,
  CaptureCollectionControlState,
  CaptureCollectionControlStore,
  OwnershipScope,
} from "@automation/core";
import { isCaptureCollectionPhase } from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const CONTROL_PREFIX = "CAPTURE_CONTROL#";
type CaptureControlCommand = GetCommand | PutCommand | UpdateCommand;

export interface CaptureControlDynamoClientLike {
  send(command: CaptureControlCommand): Promise<Record<string, unknown>>;
}

function scopePk(scope: OwnershipScope): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "capture-controls"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function controlSk(captureSessionId: string): string {
  const trimmed = captureSessionId.trim();
  if (!trimmed || trimmed.length > 512) throw new Error("captureSessionId is invalid");
  return `${CONTROL_PREFIX}${encodeURIComponent(trimmed)}`;
}

function isConditionalFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error &&
    String((error as { name?: unknown }).name) === "ConditionalCheckFailedException";
}

function parseRecord(scope: OwnershipScope, item: Record<string, unknown> | undefined): CaptureCollectionControlRecord | null {
  if (!item) return null;
  if (item.entity !== "CaptureCollectionControl") throw new Error("DynamoDB capture-control entity mismatch");
  const record = item.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("DynamoDB capture control has no record payload");
  const value = structuredClone(record as CaptureCollectionControlRecord);
  if (value.tenantId !== scope.tenantId || value.userId !== scope.userId) throw new Error("DynamoDB capture-control ownership mismatch");
  if (!value.automationId || !value.captureSessionId || !isCaptureCollectionPhase(value.phase) || typeof value.finishRequested !== "boolean") {
    throw new Error("DynamoDB capture control is malformed");
  }
  if (!Number.isFinite(new Date(value.updatedAt).getTime())) throw new Error("DynamoDB capture-control timestamp is invalid");
  return value;
}

export class AwsDynamoCaptureCollectionControlStore implements CaptureCollectionControlStore {
  constructor(private readonly client: CaptureControlDynamoClientLike, private readonly tableName: string) {
    if (!tableName.trim()) throw new Error("capture-control DynamoDB tableName is required");
  }

  async putInitial(record: CaptureCollectionControlRecord): Promise<void> {
    if (record.phase !== "AUTH_SETUP" || record.finishRequested) {
      throw new Error("initial capture control must begin in AUTH_SETUP without finish requested");
    }
    const scope = { tenantId: record.tenantId, userId: record.userId };
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: scopePk(scope),
        sk: controlSk(record.captureSessionId),
        entity: "CaptureCollectionControl",
        record: structuredClone(record),
      },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }));
  }

  private async getRecord(scope: OwnershipScope, captureSessionId: string): Promise<CaptureCollectionControlRecord | null> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: scopePk(scope), sk: controlSk(captureSessionId) },
      ConsistentRead: true,
    }));
    return parseRecord(scope, response.Item as Record<string, unknown> | undefined);
  }

  async getState(scope: OwnershipScope, captureSessionId: string): Promise<CaptureCollectionControlState> {
    const record = await this.getRecord(scope, captureSessionId);
    if (!record) throw new Error("capture collection control not found");
    return { phase: record.phase, finishRequested: record.finishRequested };
  }

  async startWorkflow(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY"> {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: scopePk(scope), sk: controlSk(captureSessionId) },
        UpdateExpression: "SET #record.#phase = :workflow, #record.#updatedAt = :updatedAt",
        ConditionExpression: "#entity = :entity AND #record.#phase = :auth AND #record.#finish = :false",
        ExpressionAttributeNames: {
          "#entity": "entity",
          "#record": "record",
          "#phase": "phase",
          "#finish": "finishRequested",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":entity": "CaptureCollectionControl",
          ":auth": "AUTH_SETUP",
          ":workflow": "WORKFLOW",
          ":false": false,
          ":updatedAt": updatedAt,
        },
      }));
      return "UPDATED";
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
      const winner = await this.getRecord(scope, captureSessionId);
      if (winner?.phase === "WORKFLOW" && !winner.finishRequested) return "REPLAY";
      if (winner?.finishRequested) throw new Error("capture collection is already finishing");
      throw new Error("capture collection control transition conflict");
    }
  }

  async requestFinish(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY"> {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: scopePk(scope), sk: controlSk(captureSessionId) },
        UpdateExpression: "SET #record.#finish = :true, #record.#updatedAt = :updatedAt",
        ConditionExpression: "#entity = :entity AND #record.#phase = :workflow AND #record.#finish = :false",
        ExpressionAttributeNames: {
          "#entity": "entity",
          "#record": "record",
          "#phase": "phase",
          "#finish": "finishRequested",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":entity": "CaptureCollectionControl",
          ":workflow": "WORKFLOW",
          ":false": false,
          ":true": true,
          ":updatedAt": updatedAt,
        },
      }));
      return "UPDATED";
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
      const winner = await this.getRecord(scope, captureSessionId);
      if (winner?.phase === "WORKFLOW" && winner.finishRequested) return "REPLAY";
      if (winner?.phase === "AUTH_SETUP") throw new Error("workflow recording must start before capture can finish");
      throw new Error("capture collection control transition conflict");
    }
  }
}
