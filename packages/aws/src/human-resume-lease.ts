import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanResolutionCommand,
  HumanResumeExecutionLease,
  HumanResumeExecutionLeaseAcquireResult,
  HumanResumeExecutionLeaseStore,
  OwnershipScope,
} from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AwsDynamoDbConfig, DynamoDocumentClientLike } from "./dynamodb-state.js";

const HUMAN_RESUME_LEASE_PREFIX = "HUMAN_RESUME_LEASE#";

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

function encodedId(value: string, label: string): string {
  return encodeURIComponent(required(value, label));
}

function scopePartition(scope: OwnershipScope): string {
  const tenantId = required(scope.tenantId, "tenantId");
  const userId = required(scope.userId, "userId");
  const digest = stableResourceToken(scopedResourceIdentity({ tenantId, userId }, "dynamodb"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function leaseSk(runId: string, nodeId: string): string {
  return `${HUMAN_RESUME_LEASE_PREFIX}${encodedId(runId, "runId")}#NODE#${encodedId(nodeId, "nodeId")}`;
}

function conditionalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    String((error as { name?: unknown }).name) === "ConditionalCheckFailedException"
  );
}

function parseLease(
  item: Record<string, unknown> | undefined,
  scope: OwnershipScope,
  runId: string,
  nodeId: string,
): HumanResumeExecutionLease | null {
  if (!item) return null;
  if (item.entity !== "HUMAN_RESUME_EXECUTION_LEASE") {
    throw new Error("DynamoDB human-resume lease item entity mismatch");
  }
  const raw = item.lease;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("DynamoDB human-resume lease item has no lease payload");
  }
  const lease = structuredClone(raw as HumanResumeExecutionLease);
  if (
    lease.tenantId !== scope.tenantId ||
    lease.userId !== scope.userId ||
    lease.runId !== runId ||
    lease.nodeId !== nodeId
  ) {
    throw new Error("DynamoDB human-resume lease identity mismatch");
  }
  if (lease.state !== "ACTIVE" && lease.state !== "COMPLETED") {
    throw new Error("DynamoDB human-resume lease state mismatch");
  }
  instant(lease.acquiredAt, "lease.acquiredAt");
  instant(lease.expiresAt, "lease.expiresAt");
  if (lease.completedAt !== undefined) instant(lease.completedAt, "lease.completedAt");
  return lease;
}

export class AwsDynamoHumanResumeExecutionLeaseStore
  implements HumanResumeExecutionLeaseStore
{
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async acquire(
    command: HumanResolutionCommand,
    ownerToken: string,
    acquiredAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLeaseAcquireResult> {
    const scope = {
      tenantId: required(command.scope.tenantId, "tenantId"),
      userId: required(command.scope.userId, "userId"),
    };
    const runId = required(command.runId, "runId");
    const nodeId = required(command.expectedNodeId, "expectedNodeId");
    const resolutionId = required(command.resolutionId, "resolutionId");
    const normalizedOwner = required(ownerToken, "ownerToken");
    const acquired = instant(acquiredAt, "acquiredAt");
    const expiresAt = new Date(acquired.getTime() + positiveTtl(ttlMs));
    const lease: HumanResumeExecutionLease = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      runId,
      nodeId,
      resolutionId,
      ownerToken: normalizedOwner,
      state: "ACTIVE",
      acquiredAt: acquired.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const key = { pk: scopePartition(scope), sk: leaseSk(runId, nodeId) };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            ...key,
            entity: "HUMAN_RESUME_EXECUTION_LEASE",
            resolutionId,
            ownerToken: normalizedOwner,
            state: "ACTIVE",
            expiresAtEpochMs: expiresAt.getTime(),
            lease: structuredClone(lease),
          },
          ConditionExpression:
            "attribute_not_exists(#pk) OR (#entity = :entity AND #resolutionId = :resolutionId AND #state = :active AND #expiresAt <= :now)",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#entity": "entity",
            "#resolutionId": "resolutionId",
            "#state": "state",
            "#expiresAt": "expiresAtEpochMs",
          },
          ExpressionAttributeValues: {
            ":entity": "HUMAN_RESUME_EXECUTION_LEASE",
            ":resolutionId": resolutionId,
            ":active": "ACTIVE",
            ":now": acquired.getTime(),
          },
        }),
      );
      return { status: "ACQUIRED", lease: structuredClone(lease) };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }

    const existing = await this.get(scope, runId, nodeId);
    if (!existing) {
      throw new Error("human-resume lease lost a conditional race but no durable winner was found");
    }
    if (existing.resolutionId !== resolutionId) return { status: "CONFLICT", lease: existing };
    if (existing.state === "COMPLETED") return { status: "COMPLETED", lease: existing };
    return { status: "BUSY", lease: existing };
  }

  async renew(
    lease: HumanResumeExecutionLease,
    renewedAt: string,
    ttlMs: number,
  ): Promise<HumanResumeExecutionLease | null> {
    const renewed = instant(renewedAt, "renewedAt");
    const next: HumanResumeExecutionLease = {
      ...lease,
      state: "ACTIVE",
      expiresAt: new Date(renewed.getTime() + positiveTtl(ttlMs)).toISOString(),
    };
    const key = {
      pk: scopePartition(lease),
      sk: leaseSk(required(lease.runId, "runId"), required(lease.nodeId, "nodeId")),
    };
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: key,
          UpdateExpression: "SET #expiresAt = :newExpiry, #lease = :lease",
          ConditionExpression:
            "#entity = :entity AND #resolutionId = :resolutionId AND #ownerToken = :ownerToken AND #state = :active AND #expiresAt > :now",
          ExpressionAttributeNames: {
            "#entity": "entity",
            "#resolutionId": "resolutionId",
            "#ownerToken": "ownerToken",
            "#state": "state",
            "#expiresAt": "expiresAtEpochMs",
            "#lease": "lease",
          },
          ExpressionAttributeValues: {
            ":entity": "HUMAN_RESUME_EXECUTION_LEASE",
            ":resolutionId": required(lease.resolutionId, "resolutionId"),
            ":ownerToken": required(lease.ownerToken, "ownerToken"),
            ":active": "ACTIVE",
            ":now": renewed.getTime(),
            ":newExpiry": new Date(next.expiresAt).getTime(),
            ":lease": structuredClone(next),
          },
        }),
      );
      return next;
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      return null;
    }
  }

  async complete(
    lease: HumanResumeExecutionLease,
    completedAt: string,
  ): Promise<HumanResumeExecutionLease | null> {
    const completed = instant(completedAt, "completedAt");
    const next: HumanResumeExecutionLease = {
      ...lease,
      state: "COMPLETED",
      completedAt: completed.toISOString(),
    };
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: {
            pk: scopePartition(lease),
            sk: leaseSk(required(lease.runId, "runId"), required(lease.nodeId, "nodeId")),
          },
          UpdateExpression: "SET #state = :completed, #lease = :lease",
          ConditionExpression:
            "#entity = :entity AND #resolutionId = :resolutionId AND #ownerToken = :ownerToken AND #state = :active AND #expiresAt > :now",
          ExpressionAttributeNames: {
            "#entity": "entity",
            "#resolutionId": "resolutionId",
            "#ownerToken": "ownerToken",
            "#state": "state",
            "#expiresAt": "expiresAtEpochMs",
            "#lease": "lease",
          },
          ExpressionAttributeValues: {
            ":entity": "HUMAN_RESUME_EXECUTION_LEASE",
            ":resolutionId": required(lease.resolutionId, "resolutionId"),
            ":ownerToken": required(lease.ownerToken, "ownerToken"),
            ":active": "ACTIVE",
            ":completed": "COMPLETED",
            ":now": completed.getTime(),
            ":lease": structuredClone(next),
          },
        }),
      );
      return next;
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      return null;
    }
  }

  async get(
    scope: OwnershipScope,
    runId: string,
    nodeId: string,
  ): Promise<HumanResumeExecutionLease | null> {
    const normalizedScope = {
      tenantId: required(scope.tenantId, "tenantId"),
      userId: required(scope.userId, "userId"),
    };
    const normalizedRunId = required(runId, "runId");
    const normalizedNodeId = required(nodeId, "nodeId");
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: {
          pk: scopePartition(normalizedScope),
          sk: leaseSk(normalizedRunId, normalizedNodeId),
        },
        ConsistentRead: true,
      }),
    );
    return parseLease(
      response.Item as Record<string, unknown> | undefined,
      normalizedScope,
      normalizedRunId,
      normalizedNodeId,
    );
  }
}
