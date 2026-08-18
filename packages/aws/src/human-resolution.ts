import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanResolutionClaim,
  HumanResolutionClaimResult,
  HumanResolutionClaimStore,
  HumanResolutionCommand,
  OwnershipScope,
} from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AwsDynamoDbConfig, DynamoDocumentClientLike } from "./dynamodb-state.js";

const HUMAN_RESOLUTION_PREFIX = "HUMAN_RESOLUTION#";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

function encodedId(value: string, label: string): string {
  return encodeURIComponent(required(value, label));
}

function scopePartition(scope: OwnershipScope): string {
  const tenantId = required(scope.tenantId, "tenantId");
  const userId = required(scope.userId, "userId");
  const digest = stableResourceToken(
    scopedResourceIdentity({ tenantId, userId }, "dynamodb"),
  );
  return `SCOPE#${digest.slice(0, 32)}`;
}

function claimSk(runId: string, nodeId: string): string {
  return `${HUMAN_RESOLUTION_PREFIX}${encodedId(runId, "runId")}#NODE#${encodedId(nodeId, "nodeId")}`;
}

function conditionalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    String((error as { name?: unknown }).name) === "ConditionalCheckFailedException"
  );
}

function parseClaim(
  item: Record<string, unknown> | undefined,
  scope: OwnershipScope,
  runId: string,
  nodeId: string,
): HumanResolutionClaim | null {
  if (!item) return null;
  if (item.entity !== "HUMAN_RESOLUTION_CLAIM") {
    throw new Error("DynamoDB human-resolution item entity mismatch");
  }
  const claim = item.claim;
  if (typeof claim !== "object" || claim === null || Array.isArray(claim)) {
    throw new Error("DynamoDB human-resolution item has no claim payload");
  }

  const value = structuredClone(claim as HumanResolutionClaim);
  if (
    value.tenantId !== scope.tenantId ||
    value.userId !== scope.userId ||
    value.runId !== runId ||
    value.nodeId !== nodeId
  ) {
    throw new Error("DynamoDB human-resolution claim identity mismatch");
  }
  return value;
}

/**
 * Durable, cross-worker human-resolution claim store.
 *
 * The claim key is ownership + run + paused node. The first resolution ID wins
 * through a conditional PutItem. Losing writers perform a strongly consistent
 * read and deterministically resolve to REPLAY or CONFLICT.
 */
export class AwsDynamoHumanResolutionClaimStore
  implements HumanResolutionClaimStore
{
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async claim(
    command: HumanResolutionCommand,
    acceptedAt: string,
  ): Promise<HumanResolutionClaimResult> {
    const scope = {
      tenantId: required(command.scope.tenantId, "tenantId"),
      userId: required(command.scope.userId, "userId"),
    };
    const runId = required(command.runId, "runId");
    const nodeId = required(command.expectedNodeId, "expectedNodeId");
    const resolutionId = required(command.resolutionId, "resolutionId");
    const acceptedInstant = new Date(acceptedAt);
    if (Number.isNaN(acceptedInstant.getTime())) {
      throw new Error("acceptedAt must be an ISO-8601 timestamp");
    }

    const claim: HumanResolutionClaim = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      runId,
      nodeId,
      resolutionId,
      acceptedAt: acceptedInstant.toISOString(),
    };
    const key = { pk: scopePartition(scope), sk: claimSk(runId, nodeId) };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            ...key,
            entity: "HUMAN_RESOLUTION_CLAIM",
            claim: structuredClone(claim),
          },
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk" },
        }),
      );
      return { status: "ACCEPTED", claim: structuredClone(claim) };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
    }

    const existing = await this.get(scope, runId, nodeId);
    if (!existing) {
      throw new Error(
        "human-resolution claim lost a conditional race but no durable winner was found",
      );
    }
    return {
      status: existing.resolutionId === resolutionId ? "REPLAY" : "CONFLICT",
      claim: existing,
    };
  }

  async get(
    scope: OwnershipScope,
    runId: string,
    nodeId: string,
  ): Promise<HumanResolutionClaim | null> {
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
          sk: claimSk(normalizedRunId, normalizedNodeId),
        },
        ConsistentRead: true,
      }),
    );
    return parseClaim(
      response.Item as Record<string, unknown> | undefined,
      normalizedScope,
      normalizedRunId,
      normalizedNodeId,
    );
  }
}
