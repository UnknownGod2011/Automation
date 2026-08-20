import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  assertCaptureTrace,
  type CaptureTrace,
} from "@automation/contracts";
import type {
  CaptureTraceRepository,
  OwnershipScope,
} from "@automation/core";
import type { AwsArtifactStoreConfig } from "./artifact-store.js";
import type {
  AwsDynamoDbConfig,
  DynamoDocumentClientLike,
} from "./dynamodb-state.js";
import {
  scopedResourceIdentity,
  stableResourceToken,
} from "./idempotency.js";
import type { S3WorkflowDocumentApi } from "./workflow-version.js";

const CAPTURE_TRACE_PREFIX = "CAPTURE_TRACE#";
const CAPTURE_DOCUMENT_PREFIX = "captures";

interface CaptureTraceMetadataItem {
  pk: string;
  sk: string;
  entity: "CAPTURE_TRACE";
  automationId: string;
  traceId: string;
  objectKey: string;
  startedAt: string;
  finishedAt: string;
}

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

function metadataPrefix(automationId: string): string {
  return `${CAPTURE_TRACE_PREFIX}${encodedId(automationId, "automationId")}#`;
}

function metadataSk(automationId: string, traceId: string): string {
  return `${metadataPrefix(automationId)}${encodedId(traceId, "traceId")}`;
}

function captureObjectKey(
  scope: OwnershipScope,
  artifactPrefix: string,
  automationId: string,
  traceId: string,
): string {
  const normalizedPrefix = artifactPrefix.replace(/^\/+|\/+$/g, "");
  if (!normalizedPrefix) throw new Error("artifact prefix is required");
  const scopeDigest = stableResourceToken(
    scopedResourceIdentity(scope, "capture-traces"),
  ).slice(0, 32);
  const automationDigest = stableResourceToken(
    scopedResourceIdentity(scope, automationId),
  ).slice(0, 32);
  const traceDigest = stableResourceToken(
    scopedResourceIdentity(scope, automationId, traceId),
  ).slice(0, 40);
  return [
    normalizedPrefix,
    CAPTURE_DOCUMENT_PREFIX,
    scopeDigest,
    automationDigest,
    `${traceDigest}.json`,
  ].join("/");
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item !== undefined) output[key] = stableJsonValue(item);
  }
  return output;
}

export function canonicalCaptureTraceBytes(trace: CaptureTrace): Uint8Array {
  assertCaptureTrace(trace);
  return new TextEncoder().encode(JSON.stringify(stableJsonValue(trace)));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function parseMetadata(item: unknown): CaptureTraceMetadataItem | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const candidate = item as Partial<CaptureTraceMetadataItem>;
  if (
    candidate.entity !== "CAPTURE_TRACE" ||
    typeof candidate.pk !== "string" ||
    typeof candidate.sk !== "string" ||
    typeof candidate.automationId !== "string" ||
    typeof candidate.traceId !== "string" ||
    typeof candidate.objectKey !== "string" ||
    typeof candidate.startedAt !== "string" ||
    typeof candidate.finishedAt !== "string"
  ) {
    throw new Error("DynamoDB capture-trace metadata is invalid");
  }
  return candidate as CaptureTraceMetadataItem;
}

function decodeTrace(bytes: Uint8Array): CaptureTrace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("S3 capture trace is not valid JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("S3 capture trace is not an object");
  }
  const trace = parsed as CaptureTrace;
  assertCaptureTrace(trace);
  return trace;
}

function assertTraceIdentity(
  scope: OwnershipScope,
  trace: CaptureTrace,
  automationId: string,
  traceId: string,
): void {
  if (
    trace.tenantId !== scope.tenantId ||
    trace.userId !== scope.userId ||
    trace.automationId !== automationId ||
    trace.traceId !== traceId
  ) {
    throw new Error("capture trace identity does not match durable metadata");
  }
}

export class AwsCaptureTraceRepository implements CaptureTraceRepository {
  constructor(
    private readonly dynamo: DynamoDocumentClientLike,
    private readonly dynamoConfig: AwsDynamoDbConfig,
    private readonly documents: S3WorkflowDocumentApi,
    private readonly artifactConfig: AwsArtifactStoreConfig,
  ) {}

  async get(
    scope: OwnershipScope,
    automationId: string,
    traceId: string,
  ): Promise<CaptureTrace | null> {
    const response = await this.dynamo.send(
      new GetCommand({
        TableName: this.dynamoConfig.tableName,
        Key: {
          pk: scopePartition(scope),
          sk: metadataSk(automationId, traceId),
        },
        ConsistentRead: true,
      }),
    );
    const metadata = parseMetadata(response.Item);
    if (!metadata) return null;
    if (metadata.automationId !== automationId || metadata.traceId !== traceId) {
      throw new Error("capture-trace metadata identity mismatch");
    }

    const bytes = await this.documents.get(metadata.objectKey);
    if (!bytes) throw new Error("capture-trace metadata points to a missing S3 document");
    const trace = decodeTrace(bytes);
    assertTraceIdentity(scope, trace, automationId, traceId);
    return trace;
  }

  async putImmutable(trace: CaptureTrace): Promise<void> {
    assertCaptureTrace(trace);
    const scope = { tenantId: trace.tenantId, userId: trace.userId };
    const pk = scopePartition(scope);
    const sk = metadataSk(trace.automationId, trace.traceId);
    const existing = await this.dynamo.send(
      new GetCommand({
        TableName: this.dynamoConfig.tableName,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    if (parseMetadata(existing.Item)) {
      throw new Error(`capture trace '${trace.traceId}' already exists`);
    }

    const objectKey = captureObjectKey(
      scope,
      this.artifactConfig.prefix,
      trace.automationId,
      trace.traceId,
    );
    const bytes = canonicalCaptureTraceBytes(trace);
    const writeResult = await this.documents.putIfAbsent(objectKey, bytes);
    if (writeResult === "EXISTS") {
      const existingBytes = await this.documents.get(objectKey);
      if (!existingBytes || !bytesEqual(existingBytes, bytes)) {
        throw new Error(
          `capture trace '${trace.traceId}' conflicts with an existing immutable S3 document`,
        );
      }
    }

    await this.dynamo.send(
      new PutCommand({
        TableName: this.dynamoConfig.tableName,
        Item: {
          pk,
          sk,
          entity: "CAPTURE_TRACE",
          automationId: trace.automationId,
          traceId: trace.traceId,
          objectKey,
          startedAt: trace.startedAt,
          finishedAt: trace.finishedAt,
        },
        ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      }),
    );
  }

  async list(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<readonly CaptureTrace[]> {
    const metadata: CaptureTraceMetadataItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.dynamoConfig.tableName,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :prefix)",
          ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
          ExpressionAttributeValues: {
            ":pk": scopePartition(scope),
            ":prefix": metadataPrefix(automationId),
          },
          ConsistentRead: true,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );
      if (Array.isArray(response.Items)) {
        for (const item of response.Items) {
          const parsed = parseMetadata(item);
          if (!parsed) throw new Error("capture-trace query returned an empty item");
          if (parsed.automationId !== automationId) {
            throw new Error("capture-trace query returned mismatched automation metadata");
          }
          metadata.push(parsed);
        }
      }
      const next = response.LastEvaluatedKey;
      exclusiveStartKey =
        typeof next === "object" && next !== null && !Array.isArray(next)
          ? (next as Record<string, unknown>)
          : undefined;
    } while (exclusiveStartKey);

    const traces = await Promise.all(
      metadata.map(async (item) => {
        const bytes = await this.documents.get(item.objectKey);
        if (!bytes) throw new Error("capture-trace metadata points to a missing S3 document");
        const trace = decodeTrace(bytes);
        assertTraceIdentity(scope, trace, automationId, item.traceId);
        return trace;
      }),
    );
    return traces.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.traceId.localeCompare(right.traceId),
    );
  }
}
