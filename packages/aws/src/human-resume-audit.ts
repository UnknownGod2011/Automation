import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanResumeAuditEvent,
  HumanResumeAuditStore,
  OwnershipScope,
} from "@automation/core";
import { assertHumanResumeAuditEvent } from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";
import type { AwsDynamoDbConfig, DynamoDocumentClientLike } from "./dynamodb-state.js";

const HUMAN_RESUME_AUDIT_PREFIX = "HUMAN_RESUME_AUDIT#";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return normalized;
}

function encodedId(value: string, label: string): string {
  return encodeURIComponent(required(value, label));
}

function auditPartition(scope: OwnershipScope, runId: string): string {
  const tenantId = required(scope.tenantId, "tenantId");
  const userId = required(scope.userId, "userId");
  const digest = stableResourceToken(scopedResourceIdentity({ tenantId, userId }, "dynamodb"));
  return `${HUMAN_RESUME_AUDIT_PREFIX}${digest.slice(0, 32)}#RUN#${encodedId(runId, "runId")}`;
}

function auditSortKey(event: HumanResumeAuditEvent): string {
  return `${event.occurredAt}#EVENT#${encodedId(event.eventId, "eventId")}`;
}

function parseEvent(item: Record<string, unknown>, scope: OwnershipScope, runId: string): HumanResumeAuditEvent {
  if (item.entity !== "HUMAN_RESUME_AUDIT_EVENT") {
    throw new Error("DynamoDB human-resume audit item entity mismatch");
  }
  const raw = item.event;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("DynamoDB human-resume audit item has no event payload");
  }
  const event = assertHumanResumeAuditEvent(structuredClone(raw as HumanResumeAuditEvent));
  if (
    event.tenantId !== scope.tenantId ||
    event.userId !== scope.userId ||
    event.runId !== runId
  ) {
    throw new Error("DynamoDB human-resume audit identity mismatch");
  }
  return event;
}

/**
 * Append-only DynamoDB persistence for redacted human-resume lifecycle events.
 * Event IDs make duplicate appends idempotent; a conflicting duplicate fails rather
 * than overwriting history.
 */
export class AwsDynamoHumanResumeAuditStore implements HumanResumeAuditStore {
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async append(input: HumanResumeAuditEvent): Promise<void> {
    const event = assertHumanResumeAuditEvent(input);
    await this.client.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: {
          pk: auditPartition(event, event.runId),
          sk: auditSortKey(event),
          entity: "HUMAN_RESUME_AUDIT_EVENT",
          event: structuredClone(event),
        },
        ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#sk": "sk",
        },
      }),
    );
  }

  async listForRun(scope: OwnershipScope, runId: string): Promise<readonly HumanResumeAuditEvent[]> {
    const normalizedRunId = required(runId, "runId");
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "pk" },
        ExpressionAttributeValues: { ":pk": auditPartition(scope, normalizedRunId) },
        ConsistentRead: true,
        ScanIndexForward: true,
      }),
    );
    const items = Array.isArray(response.Items) ? response.Items : [];
    return items.map((item) => parseEvent(item as Record<string, unknown>, scope, normalizedRunId));
  }
}
