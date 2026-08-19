import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanResumeEffectDecideResult,
  HumanResumeEffectDecision,
  HumanResumeEffectIdentity,
  HumanResumeEffectPrepareResult,
  HumanResumeEffectRecord,
  HumanResumeEffectReconciliationStore,
  OwnershipScope,
} from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AwsDynamoDbConfig, DynamoDocumentClientLike } from "./dynamodb-state.js";

const HUMAN_RESUME_EFFECT_PREFIX = "HUMAN_RESUME_EFFECT#";

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

function encodedId(value: string, label: string): string {
  return encodeURIComponent(required(value, label));
}

function scopePartition(scope: OwnershipScope): string {
  const tenantId = required(scope.tenantId, "tenantId");
  const userId = required(scope.userId, "userId");
  const digest = stableResourceToken(scopedResourceIdentity({ tenantId, userId }, "dynamodb"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function effectSk(runId: string, humanNodeId: string): string {
  return `${HUMAN_RESUME_EFFECT_PREFIX}${encodedId(runId, "runId")}#HUMAN#${encodedId(humanNodeId, "humanNodeId")}`;
}

function conditionalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    String((error as { name?: unknown }).name) === "ConditionalCheckFailedException"
  );
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

function parseRecord(
  item: Record<string, unknown> | undefined,
  scope: OwnershipScope,
  runId: string,
  humanNodeId: string,
): HumanResumeEffectRecord | null {
  if (!item) return null;
  if (item.entity !== "HUMAN_RESUME_EFFECT_RECONCILIATION") {
    throw new Error("DynamoDB human-resume effect item entity mismatch");
  }
  const raw = item.record;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("DynamoDB human-resume effect item has no record payload");
  }
  const record = structuredClone(raw as HumanResumeEffectRecord);
  if (
    record.tenantId !== scope.tenantId ||
    record.userId !== scope.userId ||
    record.runId !== runId ||
    record.humanNodeId !== humanNodeId
  ) {
    throw new Error("DynamoDB human-resume effect identity mismatch");
  }
  required(record.successorNodeId, "record.successorNodeId");
  required(record.resolutionId, "record.resolutionId");
  required(record.effectId, "record.effectId");
  instant(record.preparedAt, "record.preparedAt");
  if (record.state === "PREPARED") {
    if (record.decision !== undefined || record.decidedAt !== undefined) {
      throw new Error("DynamoDB prepared human-resume effect has decision fields");
    }
    return record;
  }
  if (record.state !== "DECIDED") {
    throw new Error("DynamoDB human-resume effect state mismatch");
  }
  if (
    record.decision !== "ALREADY_APPLIED" &&
    record.decision !== "DEFINITELY_NOT_APPLIED" &&
    record.decision !== "AMBIGUOUS"
  ) {
    throw new Error("DynamoDB human-resume effect decision mismatch");
  }
  if (!record.decidedAt) throw new Error("DynamoDB decided human-resume effect lacks decidedAt");
  instant(record.decidedAt, "record.decidedAt");
  return record;
}

export class AwsDynamoHumanResumeEffectReconciliationStore
  implements HumanResumeEffectReconciliationStore
{
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async prepare(
    identity: HumanResumeEffectIdentity,
    preparedAt: string,
  ): Promise<HumanResumeEffectPrepareResult> {
    const normalized = normalizedIdentity(identity);
    const record: HumanResumeEffectRecord = {
      ...normalized,
      state: "PREPARED",
      preparedAt: instant(preparedAt, "preparedAt"),
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            pk: scopePartition(normalized),
            sk: effectSk(normalized.runId, normalized.humanNodeId),
            entity: "HUMAN_RESUME_EFFECT_RECONCILIATION",
            effectId: normalized.effectId,
            resolutionId: normalized.resolutionId,
            successorNodeId: normalized.successorNodeId,
            state: "PREPARED",
            record: structuredClone(record),
          },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk" },
        }),
      );
      return { status: "PREPARED", record };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }

    const existing = await this.get(normalized, normalized.runId, normalized.humanNodeId);
    if (!existing) {
      throw new Error("human-resume effect lost a conditional race but no durable winner was found");
    }
    return sameIdentity(existing, normalized)
      ? { status: "REPLAY", record: existing }
      : { status: "CONFLICT", record: existing };
  }

  async decide(
    identity: HumanResumeEffectIdentity,
    decision: HumanResumeEffectDecision,
    decidedAt: string,
  ): Promise<HumanResumeEffectDecideResult> {
    const normalized = normalizedIdentity(identity);
    if (
      decision !== "ALREADY_APPLIED" &&
      decision !== "DEFINITELY_NOT_APPLIED" &&
      decision !== "AMBIGUOUS"
    ) {
      throw new Error("invalid human resume effect reconciliation decision");
    }
    const existing = await this.get(normalized, normalized.runId, normalized.humanNodeId);
    if (!existing) throw new Error("human resume effect must be prepared before reconciliation");
    if (!sameIdentity(existing, normalized)) return { status: "CONFLICT", record: existing };
    if (existing.state === "DECIDED") {
      return existing.decision === decision
        ? { status: "REPLAY", record: existing }
        : { status: "CONFLICT", record: existing };
    }

    const record: HumanResumeEffectRecord = {
      ...existing,
      state: "DECIDED",
      decision,
      decidedAt: instant(decidedAt, "decidedAt"),
    };
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: {
            pk: scopePartition(normalized),
            sk: effectSk(normalized.runId, normalized.humanNodeId),
          },
          UpdateExpression: "SET #state = :decided, #record = :record",
          ConditionExpression:
            "#entity = :entity AND #state = :prepared AND #effectId = :effectId AND #resolutionId = :resolutionId AND #successorNodeId = :successorNodeId",
          ExpressionAttributeNames: {
            "#entity": "entity",
            "#state": "state",
            "#effectId": "effectId",
            "#resolutionId": "resolutionId",
            "#successorNodeId": "successorNodeId",
            "#record": "record",
          },
          ExpressionAttributeValues: {
            ":entity": "HUMAN_RESUME_EFFECT_RECONCILIATION",
            ":prepared": "PREPARED",
            ":decided": "DECIDED",
            ":effectId": normalized.effectId,
            ":resolutionId": normalized.resolutionId,
            ":successorNodeId": normalized.successorNodeId,
            ":record": structuredClone(record),
          },
        }),
      );
      return { status: "DECIDED", record };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }

    const winner = await this.get(normalized, normalized.runId, normalized.humanNodeId);
    if (!winner) {
      throw new Error("human-resume effect reconciliation lost a conditional race but no durable winner was found");
    }
    if (!sameIdentity(winner, normalized)) return { status: "CONFLICT", record: winner };
    return winner.state === "DECIDED" && winner.decision === decision
      ? { status: "REPLAY", record: winner }
      : { status: "CONFLICT", record: winner };
  }

  async get(
    scope: OwnershipScope,
    runId: string,
    humanNodeId: string,
  ): Promise<HumanResumeEffectRecord | null> {
    const normalizedScope = {
      tenantId: required(scope.tenantId, "tenantId"),
      userId: required(scope.userId, "userId"),
    };
    const normalizedRunId = required(runId, "runId");
    const normalizedHumanNodeId = required(humanNodeId, "humanNodeId");
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: {
          pk: scopePartition(normalizedScope),
          sk: effectSk(normalizedRunId, normalizedHumanNodeId),
        },
        ConsistentRead: true,
      }),
    );
    return parseRecord(
      response.Item as Record<string, unknown> | undefined,
      normalizedScope,
      normalizedRunId,
      normalizedHumanNodeId,
    );
  }
}
