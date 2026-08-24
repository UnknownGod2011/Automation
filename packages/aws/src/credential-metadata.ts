import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ProviderCredentialMetadata } from "@automation/contracts";
import type {
  CredentialManagementMetadataRepository,
  OwnershipScope,
} from "@automation/core";
import type {
  AwsDynamoDbConfig,
  DynamoDocumentClientLike,
} from "./dynamodb-state.js";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const CREDENTIAL_PREFIX = "CREDENTIAL#";

function scopePartition(scope: OwnershipScope): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "dynamodb"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function credentialSk(credentialId: string): string {
  const normalized = credentialId.trim();
  if (!normalized) throw new Error("credentialId is required");
  if (normalized.length > 512) throw new Error("credentialId is too long");
  return `${CREDENTIAL_PREFIX}${encodeURIComponent(normalized)}`;
}

function assertRecord(
  scope: OwnershipScope,
  credentialId: string | undefined,
  item: Record<string, unknown> | undefined,
): ProviderCredentialMetadata | null {
  if (!item) return null;
  if (item.entity !== "PROVIDER_CREDENTIAL") {
    throw new Error("DynamoDB credential item entity mismatch");
  }
  const record = item.record;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("DynamoDB credential item has no record payload");
  }
  const metadata = structuredClone(record as ProviderCredentialMetadata);
  if (metadata.tenantId !== scope.tenantId || metadata.userId !== scope.userId) {
    throw new Error("DynamoDB credential ownership does not match requested scope");
  }
  if (credentialId !== undefined && metadata.credentialId !== credentialId) {
    throw new Error("DynamoDB credential identity does not match requested credential");
  }
  return metadata;
}

export class AwsDynamoCredentialMetadataRepository
  implements CredentialManagementMetadataRepository
{
  constructor(
    private readonly client: DynamoDocumentClientLike,
    private readonly config: AwsDynamoDbConfig,
  ) {}

  async put(metadata: ProviderCredentialMetadata): Promise<void> {
    const scope = { tenantId: metadata.tenantId, userId: metadata.userId };
    await this.client.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: {
          pk: scopePartition(scope),
          sk: credentialSk(metadata.credentialId),
          entity: "PROVIDER_CREDENTIAL",
          record: structuredClone(metadata),
        },
      }),
    );
  }

  async get(
    scope: OwnershipScope,
    credentialId: string,
  ): Promise<ProviderCredentialMetadata | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: credentialSk(credentialId) },
        ConsistentRead: true,
      }),
    );
    return assertRecord(
      scope,
      credentialId,
      response.Item as Record<string, unknown> | undefined,
    );
  }

  async list(scope: OwnershipScope): Promise<readonly ProviderCredentialMetadata[]> {
    const records: ProviderCredentialMetadata[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(
        new QueryCommand({
          TableName: this.config.tableName,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
          ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
          ExpressionAttributeValues: {
            ":pk": scopePartition(scope),
            ":prefix": CREDENTIAL_PREFIX,
          },
          ConsistentRead: true,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );
      if (Array.isArray(response.Items)) {
        for (const item of response.Items) {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error("DynamoDB credential query returned an invalid item");
          }
          const record = assertRecord(scope, undefined, item as Record<string, unknown>);
          if (!record) throw new Error("DynamoDB credential query returned an empty item");
          records.push(record);
        }
      }
      const next = response.LastEvaluatedKey;
      exclusiveStartKey =
        next && typeof next === "object" && !Array.isArray(next)
          ? (next as Record<string, unknown>)
          : undefined;
    } while (exclusiveStartKey);

    return records.sort(
      (a, b) =>
        a.priority - b.priority ||
        a.provider.localeCompare(b.provider) ||
        a.credentialId.localeCompare(b.credentialId),
    );
  }

  async delete(scope: OwnershipScope, credentialId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.config.tableName,
        Key: { pk: scopePartition(scope), sk: credentialSk(credentialId) },
      }),
    );
  }
}