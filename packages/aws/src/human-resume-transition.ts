import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanResumeAlreadyAppliedTransitionRequest,
  HumanResumeAlreadyAppliedTransitionResult,
  HumanResumeAlreadyAppliedTransitionStore,
  HumanResumeRecoveryContinuation,
  OwnershipScope,
} from "@automation/core";
import {
  assertAlreadyAppliedRecoveryTransition,
  buildAlreadyAppliedRecoveryContinuation,
  buildAlreadyAppliedRecoveryRun,
} from "@automation/core";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AwsDynamoDbConfig, DynamoDocumentClientLike } from "./dynamodb-state.js";

const RUN_PREFIX = "RUN#";
const CHECKPOINT_PREFIX = "CHECKPOINT#";
const HUMAN_RESUME_LEASE_PREFIX = "HUMAN_RESUME_LEASE#";
const HUMAN_RESUME_CONTINUATION_PREFIX = "HUMAN_RESUME_CONTINUATION#";

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
  const digest = stableResourceToken(scopedResourceIdentity({ tenantId, userId }, "dynamodb"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function runSk(runId: string): string {
  return `${RUN_PREFIX}${encodedId(runId, "runId")}`;
}

function checkpointSk(runId: string): string {
  return `${CHECKPOINT_PREFIX}${encodedId(runId, "runId")}`;
}

function leaseSk(runId: string, nodeId: string): string {
  return `${HUMAN_RESUME_LEASE_PREFIX}${encodedId(runId, "runId")}#NODE#${encodedId(nodeId, "nodeId")}`;
}

function continuationSk(runId: string, humanNodeId: string): string {
  return `${HUMAN_RESUME_CONTINUATION_PREFIX}${encodedId(runId, "runId")}#NODE#${encodedId(humanNodeId, "humanNodeId")}`;
}

function transactionId(request: HumanResumeAlreadyAppliedTransitionRequest): string {
  const identity = [
    request.scope.tenantId,
    request.scope.userId,
    request.expectedRun.runId,
    request.effect.humanNodeId,
    request.effect.successorNodeId,
    request.effect.resolutionId,
    request.effect.effectId,
    request.lease.ownerToken,
    request.expectedCheckpoint.updatedAt,
    request.nextCheckpoint.updatedAt,
    request.committedAt,
  ].join("\u0000");
  return `recovery-${stableResourceToken(identity).slice(0, 27)}`;
}

function conditionalTransactionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const candidate = error as {
    name?: unknown;
    CancellationReasons?: readonly { Code?: unknown }[];
  };
  const name = String(candidate.name);
  if (name === "ConditionalCheckFailedException") return true;
  if (name !== "TransactionCanceledException") return false;
  const reasons = candidate.CancellationReasons;
  if (!Array.isArray(reasons) || reasons.length === 0) return false;
  let conditional = false;
  for (const reason of reasons) {
    const code = String(reason.Code ?? "None");
    if (code === "ConditionalCheckFailed") conditional = true;
    else if (code !== "None") return false;
  }
  return conditional;
}

function recordFromItem<T>(
  item: Record<string, unknown> | undefined,
  entity: string,
): { record: T; transitionId?: string } | null {
  if (!item) return null;
  if (item.entity !== entity) throw new Error(`DynamoDB ${entity} entity mismatch`);
  if (typeof item.record !== "object" || item.record === null || Array.isArray(item.record)) {
    throw new Error(`DynamoDB ${entity} item has no record payload`);
  }
  return {
    record: structuredClone(item.record as T),
    ...(typeof item.recoveryTransitionId === "string"
      ? { transitionId: item.recoveryTransitionId }
      : {}),
  };
}

function sameRecoveredState(
  run: RunRecord,
  checkpoint: RunCheckpoint,
  continuation: HumanResumeRecoveryContinuation,
  expectedRun: RunRecord,
  nextCheckpoint: RunCheckpoint,
  expectedContinuation: HumanResumeRecoveryContinuation,
): boolean {
  return (
    run.tenantId === expectedRun.tenantId &&
    run.userId === expectedRun.userId &&
    run.runId === expectedRun.runId &&
    run.automationId === expectedRun.automationId &&
    run.workflowVersion === expectedRun.workflowVersion &&
    run.occurrenceKey === expectedRun.occurrenceKey &&
    run.status === "RUNNING" &&
    run.currentNodeId === nextCheckpoint.currentNodeId &&
    checkpoint.runId === nextCheckpoint.runId &&
    checkpoint.automationId === nextCheckpoint.automationId &&
    checkpoint.workflowVersion === nextCheckpoint.workflowVersion &&
    checkpoint.currentNodeId === nextCheckpoint.currentNodeId &&
    checkpoint.updatedAt === nextCheckpoint.updatedAt &&
    continuation.tenantId === expectedContinuation.tenantId &&
    continuation.userId === expectedContinuation.userId &&
    continuation.runId === expectedContinuation.runId &&
    continuation.automationId === expectedContinuation.automationId &&
    continuation.workflowVersion === expectedContinuation.workflowVersion &&
    continuation.humanNodeId === expectedContinuation.humanNodeId &&
    continuation.resolutionId === expectedContinuation.resolutionId &&
    continuation.effectId === expectedContinuation.effectId &&
    continuation.nextNodeId === expectedContinuation.nextNodeId &&
    continuation.state === "PENDING" &&
    continuation.createdAt === expectedContinuation.createdAt
  );
}

export class AwsDynamoHumanResumeAlreadyAppliedTransitionStore
  implements HumanResumeAlreadyAppliedTransitionStore
{
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async commit(
    request: HumanResumeAlreadyAppliedTransitionRequest,
  ): Promise<HumanResumeAlreadyAppliedTransitionResult> {
    assertAlreadyAppliedRecoveryTransition(request);
    const nextRun = buildAlreadyAppliedRecoveryRun(request);
    const continuation = buildAlreadyAppliedRecoveryContinuation(request);
    const pk = scopePartition(request.scope);
    const transitionId = transactionId(request);
    const committedAtMs = new Date(request.committedAt).getTime();

    try {
      await this.client.send(
        new TransactWriteCommand({
          ClientRequestToken: transitionId,
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.config.tableName,
                Key: { pk, sk: leaseSk(request.expectedRun.runId, request.effect.humanNodeId) },
                ConditionExpression:
                  "#entity = :leaseEntity AND #resolutionId = :resolutionId AND #ownerToken = :ownerToken AND #state = :active AND #expiresAt > :now",
                ExpressionAttributeNames: {
                  "#entity": "entity",
                  "#resolutionId": "resolutionId",
                  "#ownerToken": "ownerToken",
                  "#state": "state",
                  "#expiresAt": "expiresAtEpochMs",
                },
                ExpressionAttributeValues: {
                  ":leaseEntity": "HUMAN_RESUME_EXECUTION_LEASE",
                  ":resolutionId": request.lease.resolutionId,
                  ":ownerToken": request.lease.ownerToken,
                  ":active": "ACTIVE",
                  ":now": committedAtMs,
                },
              },
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: {
                  pk,
                  sk: runSk(nextRun.runId),
                  entity: "RUN",
                  automationId: nextRun.automationId,
                  workflowVersion: nextRun.workflowVersion,
                  occurrenceKey: nextRun.occurrenceKey,
                  gsi1pk: `${pk}#AUTOMATION#${encodedId(nextRun.automationId, "automationId")}`,
                  gsi1sk: `${nextRun.scheduledAt}#${encodedId(nextRun.runId, "runId")}`,
                  recoveryTransitionId: transitionId,
                  record: structuredClone(nextRun),
                },
                ConditionExpression:
                  "#entity = :runEntity AND #automationId = :automationId AND #workflowVersion = :workflowVersion AND #occurrenceKey = :occurrenceKey AND #record.#status = :waiting AND #record.#currentNodeId = :humanNodeId",
                ExpressionAttributeNames: {
                  "#entity": "entity",
                  "#automationId": "automationId",
                  "#workflowVersion": "workflowVersion",
                  "#occurrenceKey": "occurrenceKey",
                  "#record": "record",
                  "#status": "status",
                  "#currentNodeId": "currentNodeId",
                },
                ExpressionAttributeValues: {
                  ":runEntity": "RUN",
                  ":automationId": request.expectedRun.automationId,
                  ":workflowVersion": request.expectedRun.workflowVersion,
                  ":occurrenceKey": request.expectedRun.occurrenceKey,
                  ":waiting": "WAITING_FOR_HUMAN",
                  ":humanNodeId": request.effect.humanNodeId,
                },
              },
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: {
                  pk,
                  sk: checkpointSk(request.nextCheckpoint.runId),
                  entity: "CHECKPOINT",
                  automationId: request.nextCheckpoint.automationId,
                  workflowVersion: request.nextCheckpoint.workflowVersion,
                  recoveryTransitionId: transitionId,
                  record: structuredClone(request.nextCheckpoint),
                },
                ConditionExpression:
                  "#entity = :checkpointEntity AND #automationId = :automationId AND #workflowVersion = :workflowVersion AND #record.#currentNodeId = :humanNodeId AND #record.#updatedAt = :expectedUpdatedAt",
                ExpressionAttributeNames: {
                  "#entity": "entity",
                  "#automationId": "automationId",
                  "#workflowVersion": "workflowVersion",
                  "#record": "record",
                  "#currentNodeId": "currentNodeId",
                  "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                  ":checkpointEntity": "CHECKPOINT",
                  ":automationId": request.expectedCheckpoint.automationId,
                  ":workflowVersion": request.expectedCheckpoint.workflowVersion,
                  ":humanNodeId": request.effect.humanNodeId,
                  ":expectedUpdatedAt": request.expectedCheckpoint.updatedAt,
                },
              },
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: {
                  pk,
                  sk: continuationSk(request.expectedRun.runId, request.effect.humanNodeId),
                  entity: "HUMAN_RESUME_RECOVERY_CONTINUATION",
                  recoveryTransitionId: transitionId,
                  record: structuredClone(continuation),
                },
                ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
                ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
              },
            },
          ],
        }),
      );
      return {
        status: "APPLIED",
        run: structuredClone(nextRun),
        checkpoint: structuredClone(request.nextCheckpoint),
        continuation: structuredClone(continuation),
      };
    } catch (error) {
      if (!conditionalTransactionFailure(error)) throw error;
    }

    const [runResponse, checkpointResponse, continuationResponse] = await Promise.all([
      this.client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk, sk: runSk(request.expectedRun.runId) },
          ConsistentRead: true,
        }),
      ),
      this.client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk, sk: checkpointSk(request.expectedRun.runId) },
          ConsistentRead: true,
        }),
      ),
      this.client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk, sk: continuationSk(request.expectedRun.runId, request.effect.humanNodeId) },
          ConsistentRead: true,
        }),
      ),
    ]);
    const durableRun = recordFromItem<RunRecord>(
      runResponse.Item as Record<string, unknown> | undefined,
      "RUN",
    );
    const durableCheckpoint = recordFromItem<RunCheckpoint>(
      checkpointResponse.Item as Record<string, unknown> | undefined,
      "CHECKPOINT",
    );
    const durableContinuation = recordFromItem<HumanResumeRecoveryContinuation>(
      continuationResponse.Item as Record<string, unknown> | undefined,
      "HUMAN_RESUME_RECOVERY_CONTINUATION",
    );
    if (
      durableRun?.transitionId === transitionId &&
      durableCheckpoint?.transitionId === transitionId &&
      durableContinuation?.transitionId === transitionId &&
      sameRecoveredState(
        durableRun.record,
        durableCheckpoint.record,
        durableContinuation.record,
        request.expectedRun,
        request.nextCheckpoint,
        continuation,
      )
    ) {
      return {
        status: "REPLAY",
        run: durableRun.record,
        checkpoint: durableCheckpoint.record,
        continuation: durableContinuation.record,
      };
    }
    return { status: "CONFLICT" };
  }
}
