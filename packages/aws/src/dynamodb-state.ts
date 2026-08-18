import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  AutomationLockManager,
  AutomationRepository,
  CheckpointRepository,
  CreateRunResult,
  LockLease,
  OwnershipScope,
  RunPreflightCheck,
  RunPreflightCheckResult,
  RunRepository,
} from "@automation/core";
import type {
  AutomationRecord,
  RunCheckpoint,
  RunRecord,
} from "@automation/contracts";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const AUTOMATION_PREFIX = "AUTOMATION#";
const RUN_PREFIX = "RUN#";
const CHECKPOINT_PREFIX = "CHECKPOINT#";
const OCCURRENCE_PREFIX = "OCCURRENCE#";
const LOCK_PREFIX = "LOCK#";
const DEFAULT_AUTOMATION_RUNS_INDEX = "gsi1";

type DynamoCommand =
  | DeleteCommand
  | GetCommand
  | PutCommand
  | QueryCommand
  | TransactWriteCommand
  | UpdateCommand;

export interface DynamoDocumentClientLike {
  send(command: DynamoCommand): Promise<Record<string, unknown>>;
}

export interface AwsDynamoDbConfig {
  tableName: string;
  automationRunsIndexName: string;
}

export type AwsDynamoDbConfigResult =
  | { configured: true; config: AwsDynamoDbConfig }
  | { configured: false; missing: readonly string[]; message: string };

function encodedId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return encodeURIComponent(normalized);
}

function scopePartition(scope: OwnershipScope): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "dynamodb"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function automationSk(automationId: string): string {
  return `${AUTOMATION_PREFIX}${encodedId(automationId, "automationId")}`;
}

function runSk(runId: string): string {
  return `${RUN_PREFIX}${encodedId(runId, "runId")}`;
}

function checkpointSk(runId: string): string {
  return `${CHECKPOINT_PREFIX}${encodedId(runId, "runId")}`;
}

function occurrenceSk(occurrenceKey: string): string {
  return `${OCCURRENCE_PREFIX}${encodedId(occurrenceKey, "occurrenceKey")}`;
}

function lockSk(automationId: string): string {
  return `${LOCK_PREFIX}${encodedId(automationId, "automationId")}`;
}

function automationRunsPk(scope: OwnershipScope, automationId: string): string {
  return `${scopePartition(scope)}#${AUTOMATION_PREFIX}${encodedId(automationId, "automationId")}`;
}

function automationRunsSk(run: RunRecord): string {
  return `${run.scheduledAt}#${encodedId(run.runId, "runId")}`;
}

function conditionalFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = String((error as { name?: unknown }).name);
  return (
    name === "ConditionalCheckFailedException" ||
    name === "TransactionCanceledException"
  );
}

function itemRecord<T>(
  item: Record<string, unknown> | undefined,
  expectedEntity: string,
): T | null {
  if (!item) return null;
  if (item.entity !== expectedEntity) {
    throw new Error(`DynamoDB item entity mismatch: expected ${expectedEntity}`);
  }
  const record = item.record;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error(`DynamoDB ${expectedEntity} item has no record payload`);
  }
  return structuredClone(record as T);
}

function assertOwnedRecord(
  scope: OwnershipScope,
  record: { tenantId: string; userId: string },
): void {
  if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
    throw new Error("DynamoDB record ownership does not match requested scope");
  }
}

function transactionToken(scope: OwnershipScope, occurrenceKey: string): string {
  return `run${stableResourceToken(scopedResourceIdentity(scope, occurrenceKey)).slice(0, 32)}`;
}

async function queryAll(
  client: DynamoDocumentClientLike,
  input: ConstructorParameters<typeof QueryCommand>[0],
): Promise<readonly Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(
      new QueryCommand({
        ...input,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    const page = response.Items;
    if (Array.isArray(page)) {
      for (const item of page) {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          items.push(item as Record<string, unknown>);
        }
      }
    }
    const next = response.LastEvaluatedKey;
    exclusiveStartKey =
      typeof next === "object" && next !== null && !Array.isArray(next)
        ? (next as Record<string, unknown>)
        : undefined;
  } while (exclusiveStartKey);

  return items;
}

export function loadAwsDynamoDbConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsDynamoDbConfigResult {
  const tableName = env.AWS_DYNAMODB_TABLE?.trim();
  if (!tableName) {
    return {
      configured: false,
      missing: ["AWS_DYNAMODB_TABLE"],
      message: "AWS DynamoDB state store is not configured: missing AWS_DYNAMODB_TABLE",
    };
  }

  return {
    configured: true,
    config: {
      tableName,
      automationRunsIndexName:
        env.AWS_DYNAMODB_AUTOMATION_RUNS_INDEX?.trim() ||
        DEFAULT_AUTOMATION_RUNS_INDEX,
    },
  };
}

export class AwsDynamoDbConfigurationPreflightCheck
  implements RunPreflightCheck
{
  constructor(private readonly result: AwsDynamoDbConfigResult) {}

  async check(): Promise<RunPreflightCheckResult> {
    if (this.result.configured) return { ready: true };
    return {
      ready: false,
      disposition: "WAITING_FOR_HUMAN",
      failure: {
        code: "NOT_CONFIGURED",
        message: this.result.message,
        retryable: false,
        evidenceRefs: [],
      },
    };
  }
}

export function createAwsDynamoDocumentClient(
  config: DynamoDBClientConfig,
): DynamoDocumentClientLike {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client as unknown as DynamoDocumentClientLike;
}

export class AwsDynamoAutomationRepository implements AutomationRepository {
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async get(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<AutomationRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: automationSk(automationId) },
        ConsistentRead: true,
      }),
    );
    const record = itemRecord<AutomationRecord>(
      response.Item as Record<string, unknown> | undefined,
      "AUTOMATION",
    );
    if (record) assertOwnedRecord(scope, record);
    return record;
  }

  async put(record: AutomationRecord): Promise<void> {
    const scope = { tenantId: record.tenantId, userId: record.userId };
    await this.client.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: {
          pk: scopePartition(scope),
          sk: automationSk(record.automationId),
          entity: "AUTOMATION",
          record: structuredClone(record),
        },
      }),
    );
  }

  async list(scope: OwnershipScope): Promise<readonly AutomationRecord[]> {
    const items = await queryAll(this.client, {
      TableName: this.config.tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: {
        ":pk": scopePartition(scope),
        ":prefix": AUTOMATION_PREFIX,
      },
      ConsistentRead: true,
    });
    return items.map((item) => {
      const record = itemRecord<AutomationRecord>(item, "AUTOMATION");
      if (!record) throw new Error("DynamoDB automation query returned an empty item");
      assertOwnedRecord(scope, record);
      return record;
    });
  }
}

export class AwsDynamoRunRepository implements RunRepository {
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async createIfAbsent(run: RunRecord): Promise<CreateRunResult> {
    const scope = { tenantId: run.tenantId, userId: run.userId };
    const pk = scopePartition(scope);
    const runItem = {
      pk,
      sk: runSk(run.runId),
      entity: "RUN",
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      occurrenceKey: run.occurrenceKey,
      gsi1pk: automationRunsPk(scope, run.automationId),
      gsi1sk: automationRunsSk(run),
      record: structuredClone(run),
    };
    const occurrenceItem = {
      pk,
      sk: occurrenceSk(run.occurrenceKey),
      entity: "RUN_OCCURRENCE",
      runId: run.runId,
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          ClientRequestToken: transactionToken(scope, run.occurrenceKey),
          TransactItems: [
            {
              Put: {
                TableName: this.config.tableName,
                Item: runItem,
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: { "#pk": "pk" },
              },
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: occurrenceItem,
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: { "#pk": "pk" },
              },
            },
          ],
        }),
      );
      return { created: true, run: structuredClone(run) };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;

      const occurrence = await this.client.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { pk, sk: occurrenceSk(run.occurrenceKey) },
          ConsistentRead: true,
        }),
      );
      const occurrenceItemExisting = occurrence.Item as
        | Record<string, unknown>
        | undefined;
      if (occurrenceItemExisting?.entity === "RUN_OCCURRENCE") {
        const existingRunId = occurrenceItemExisting.runId;
        if (typeof existingRunId !== "string") {
          throw new Error("DynamoDB occurrence guard has no runId");
        }
        const existing = await this.get(scope, existingRunId);
        if (!existing) {
          throw new Error("DynamoDB occurrence guard points to a missing run");
        }
        return { created: false, run: existing };
      }

      const conflictingRun = await this.get(scope, run.runId);
      if (conflictingRun) {
        throw new Error(`run '${run.runId}' already exists with another occurrence`);
      }
      throw error;
    }
  }

  async get(scope: OwnershipScope, runId: string): Promise<RunRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: runSk(runId) },
        ConsistentRead: true,
      }),
    );
    const record = itemRecord<RunRecord>(
      response.Item as Record<string, unknown> | undefined,
      "RUN",
    );
    if (record) assertOwnedRecord(scope, record);
    return record;
  }

  async update(run: RunRecord): Promise<void> {
    const scope = { tenantId: run.tenantId, userId: run.userId };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            pk: scopePartition(scope),
            sk: runSk(run.runId),
            entity: "RUN",
            automationId: run.automationId,
            workflowVersion: run.workflowVersion,
            occurrenceKey: run.occurrenceKey,
            gsi1pk: automationRunsPk(scope, run.automationId),
            gsi1sk: automationRunsSk(run),
            record: structuredClone(run),
          },
          ConditionExpression:
            "attribute_exists(#pk) AND #entity = :entity AND #automationId = :automationId AND #workflowVersion = :workflowVersion AND #occurrenceKey = :occurrenceKey",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#entity": "entity",
            "#automationId": "automationId",
            "#workflowVersion": "workflowVersion",
            "#occurrenceKey": "occurrenceKey",
          },
          ExpressionAttributeValues: {
            ":entity": "RUN",
            ":automationId": run.automationId,
            ":workflowVersion": run.workflowVersion,
            ":occurrenceKey": run.occurrenceKey,
          },
        }),
      );
    } catch (error) {
      if (conditionalFailure(error)) {
        throw new Error("immutable run identity fields cannot be changed", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async listForAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<readonly RunRecord[]> {
    const items = await queryAll(this.client, {
      TableName: this.config.tableName,
      IndexName: this.config.automationRunsIndexName,
      KeyConditionExpression: "#gsi1pk = :pk",
      ExpressionAttributeNames: { "#gsi1pk": "gsi1pk" },
      ExpressionAttributeValues: {
        ":pk": automationRunsPk(scope, automationId),
      },
      ScanIndexForward: true,
    });
    return items.map((item) => {
      const record = itemRecord<RunRecord>(item, "RUN");
      if (!record) throw new Error("DynamoDB run query returned an empty item");
      assertOwnedRecord(scope, record);
      return record;
    });
  }
}

export class AwsDynamoCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async get(
    scope: OwnershipScope,
    runId: string,
  ): Promise<RunCheckpoint | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: checkpointSk(runId) },
        ConsistentRead: true,
      }),
    );
    return itemRecord<RunCheckpoint>(
      response.Item as Record<string, unknown> | undefined,
      "CHECKPOINT",
    );
  }

  async put(scope: OwnershipScope, checkpoint: RunCheckpoint): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: {
          pk: scopePartition(scope),
          sk: checkpointSk(checkpoint.runId),
          entity: "CHECKPOINT",
          automationId: checkpoint.automationId,
          workflowVersion: checkpoint.workflowVersion,
          record: structuredClone(checkpoint),
        },
      }),
    );
  }
}

interface LockItem {
  pk: string;
  sk: string;
  entity: "LOCK";
  automationId: string;
  ownerToken: string;
  expiresAt: string;
  expiresAtEpochMs: number;
  ttl: number;
}

function asLockItem(item: unknown): LockItem | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const candidate = item as Partial<LockItem>;
  if (
    candidate.entity !== "LOCK" ||
    typeof candidate.automationId !== "string" ||
    typeof candidate.ownerToken !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.expiresAtEpochMs !== "number"
  ) {
    return null;
  }
  return candidate as LockItem;
}

export class AwsDynamoAutomationLockManager implements AutomationLockManager {
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acquire(
    scope: OwnershipScope,
    automationId: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<LockLease | null> {
    this.validateLeaseInput(ownerToken, ttlMs);
    const nowMs = this.now().getTime();
    const expiresMs = nowMs + ttlMs;
    const lease: LockLease = {
      automationId,
      ownerToken,
      expiresAt: new Date(expiresMs).toISOString(),
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: {
            pk: scopePartition(scope),
            sk: lockSk(automationId),
            entity: "LOCK",
            automationId,
            ownerToken,
            expiresAt: lease.expiresAt,
            expiresAtEpochMs: expiresMs,
            ttl: Math.ceil(expiresMs / 1_000),
          },
          ConditionExpression:
            "attribute_not_exists(#pk) OR #expiresAtEpochMs <= :now OR #ownerToken = :ownerToken",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#expiresAtEpochMs": "expiresAtEpochMs",
            "#ownerToken": "ownerToken",
          },
          ExpressionAttributeValues: {
            ":now": nowMs,
            ":ownerToken": ownerToken,
          },
        }),
      );
      return lease;
    } catch (error) {
      if (conditionalFailure(error)) return null;
      throw error;
    }
  }

  async renew(
    scope: OwnershipScope,
    lease: LockLease,
    ttlMs: number,
  ): Promise<LockLease | null> {
    this.validateLeaseInput(lease.ownerToken, ttlMs);
    const nowMs = this.now().getTime();
    const expiresMs = nowMs + ttlMs;

    try {
      const response = await this.client.send(
        new UpdateCommand({
          TableName: this.config.tableName,
          Key: { pk: scopePartition(scope), sk: lockSk(lease.automationId) },
          UpdateExpression:
            "SET #expiresAt = :expiresAt, #expiresAtEpochMs = :expiresAtEpochMs, #ttl = :ttl",
          ConditionExpression:
            "#entity = :entity AND #ownerToken = :ownerToken AND #expiresAtEpochMs > :now",
          ExpressionAttributeNames: {
            "#entity": "entity",
            "#ownerToken": "ownerToken",
            "#expiresAt": "expiresAt",
            "#expiresAtEpochMs": "expiresAtEpochMs",
            "#ttl": "ttl",
          },
          ExpressionAttributeValues: {
            ":entity": "LOCK",
            ":ownerToken": lease.ownerToken,
            ":now": nowMs,
            ":expiresAt": new Date(expiresMs).toISOString(),
            ":expiresAtEpochMs": expiresMs,
            ":ttl": Math.ceil(expiresMs / 1_000),
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      const item = asLockItem(response.Attributes);
      if (!item) throw new Error("DynamoDB lock renewal returned invalid state");
      return {
        automationId: item.automationId,
        ownerToken: item.ownerToken,
        expiresAt: item.expiresAt,
      };
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      const current = await this.getLock(scope, lease.automationId);
      if (!current || current.expiresAtEpochMs <= nowMs) return null;
      if (current.ownerToken !== lease.ownerToken) {
        throw new Error("lock lease is not owned by caller", { cause: error });
      }
      return null;
    }
  }

  async release(scope: OwnershipScope, lease: LockLease): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.config.tableName,
          Key: { pk: scopePartition(scope), sk: lockSk(lease.automationId) },
          ConditionExpression: "#entity = :entity AND #ownerToken = :ownerToken",
          ExpressionAttributeNames: {
            "#entity": "entity",
            "#ownerToken": "ownerToken",
          },
          ExpressionAttributeValues: {
            ":entity": "LOCK",
            ":ownerToken": lease.ownerToken,
          },
        }),
      );
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      const current = await this.getLock(scope, lease.automationId);
      if (!current) return;
      if (current.ownerToken !== lease.ownerToken) {
        throw new Error("lock lease is not owned by caller", { cause: error });
      }
    }
  }

  private validateLeaseInput(ownerToken: string, ttlMs: number): void {
    if (!ownerToken.trim()) throw new Error("lock ownerToken is required");
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("lock ttlMs must be a positive integer");
    }
  }

  private async getLock(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<LockItem | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: lockSk(automationId) },
        ConsistentRead: true,
      }),
    );
    return asLockItem(response.Item);
  }
}
