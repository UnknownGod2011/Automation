import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  assertWorkflowGraph,
  type WorkflowGraph,
} from "@automation/contracts";
import type {
  OwnershipScope,
  WorkflowVersionRepository,
} from "@automation/core";
import type {
  AwsArtifactStoreConfig,
} from "./artifact-store.js";
import type {
  AwsDynamoDbConfig,
  DynamoDocumentClientLike,
} from "./dynamodb-state.js";
import {
  scopedResourceIdentity,
  stableResourceToken,
} from "./idempotency.js";

const WORKFLOW_METADATA_PREFIX = "WORKFLOW#";
const WORKFLOW_DOCUMENT_PREFIX = "workflows";

export interface S3WorkflowDocumentApi {
  putIfAbsent(key: string, content: Uint8Array): Promise<"CREATED" | "EXISTS">;
  get(key: string): Promise<Uint8Array | null>;
}

interface WorkflowMetadataItem {
  pk: string;
  sk: string;
  entity: "WORKFLOW_VERSION";
  automationId: string;
  version: number;
  workflowId: string;
  objectKey: string;
  createdAt: string;
  publishedAt?: string;
}

function encodedId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 512) throw new Error(`${label} is too long`);
  return encodeURIComponent(normalized);
}

function scopeDigest(scope: OwnershipScope): string {
  return stableResourceToken(scopedResourceIdentity(scope, "workflow-versions"));
}

function scopePartition(scope: OwnershipScope): string {
  return `SCOPE#${stableResourceToken(scopedResourceIdentity(scope, "dynamodb")).slice(0, 32)}`;
}

function metadataPrefix(automationId: string): string {
  return `${WORKFLOW_METADATA_PREFIX}${encodedId(automationId, "automationId")}#V`;
}

function metadataSk(automationId: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("workflow version must be a positive integer");
  }
  return `${metadataPrefix(automationId)}${version.toString().padStart(10, "0")}`;
}

function workflowObjectKey(
  scope: OwnershipScope,
  artifactPrefix: string,
  automationId: string,
  version: number,
): string {
  const normalizedPrefix = artifactPrefix.replace(/^\/+|\/+$/g, "");
  if (!normalizedPrefix) throw new Error("artifact prefix is required");
  const automationDigest = stableResourceToken(
    scopedResourceIdentity(scope, automationId),
  ).slice(0, 32);
  return [
    normalizedPrefix,
    WORKFLOW_DOCUMENT_PREFIX,
    scopeDigest(scope).slice(0, 32),
    automationDigest,
    `v${version.toString().padStart(10, "0")}.json`,
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

export function canonicalWorkflowBytes(graph: WorkflowGraph): Uint8Array {
  assertWorkflowGraph(graph);
  return new TextEncoder().encode(JSON.stringify(stableJsonValue(graph)));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

function isPreconditionFailed(error: unknown): boolean {
  return errorName(error) === "PreconditionFailed" || httpStatus(error) === 412;
}

function isConditionalConflict(error: unknown): boolean {
  return errorName(error) === "ConditionalRequestConflict" || httpStatus(error) === 409;
}

function isDynamoConditionalFailure(error: unknown): boolean {
  return errorName(error) === "ConditionalCheckFailedException";
}

function isS3NotFound(error: unknown): boolean {
  const name = errorName(error);
  return name === "NoSuchKey" || name === "NotFound" || httpStatus(error) === 404;
}

function parseMetadata(item: unknown): WorkflowMetadataItem | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const candidate = item as Partial<WorkflowMetadataItem>;
  if (
    candidate.entity !== "WORKFLOW_VERSION" ||
    typeof candidate.pk !== "string" ||
    typeof candidate.sk !== "string" ||
    typeof candidate.automationId !== "string" ||
    typeof candidate.version !== "number" ||
    typeof candidate.workflowId !== "string" ||
    typeof candidate.objectKey !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    throw new Error("DynamoDB workflow metadata is invalid");
  }
  return candidate as WorkflowMetadataItem;
}

function decodeWorkflowDocument(bytes: Uint8Array): WorkflowGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("S3 workflow document is not valid JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("S3 workflow document is not an object");
  }
  const graph = parsed as WorkflowGraph;
  assertWorkflowGraph(graph);
  return graph;
}

async function queryAllMetadata(
  client: DynamoDocumentClientLike,
  tableName: string,
  scope: OwnershipScope,
  automationId: string,
): Promise<readonly WorkflowMetadataItem[]> {
  const items: WorkflowMetadataItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await client.send(
      new QueryCommand({
        TableName: tableName,
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
        const metadata = parseMetadata(item);
        if (metadata) items.push(metadata);
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

export class AwsSdkS3WorkflowDocumentApi implements S3WorkflowDocumentApi {
  private readonly client: S3Client;

  constructor(
    private readonly config: AwsArtifactStoreConfig,
    clientConfig: S3ClientConfig | S3Client,
  ) {
    this.client = clientConfig instanceof S3Client ? clientConfig : new S3Client(clientConfig);
  }

  async putIfAbsent(
    key: string,
    content: Uint8Array,
  ): Promise<"CREATED" | "EXISTS"> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
            Body: content,
            ContentType: "application/json",
            IfNoneMatch: "*",
            ServerSideEncryption: "aws:kms",
            ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
          }),
        );
        return "CREATED";
      } catch (error) {
        if (isPreconditionFailed(error)) return "EXISTS";
        if (isConditionalConflict(error) && attempt < 3) continue;
        throw error;
      }
    }
    throw new Error("unreachable workflow document write state");
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!response.Body) return new Uint8Array();
      return Uint8Array.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isS3NotFound(error)) return null;
      throw error;
    }
  }
}

export class AwsWorkflowVersionRepository implements WorkflowVersionRepository {
  constructor(
    private readonly dynamo: DynamoDocumentClientLike,
    private readonly dynamoConfig: AwsDynamoDbConfig,
    private readonly documents: S3WorkflowDocumentApi,
    private readonly artifactConfig: AwsArtifactStoreConfig,
  ) {}

  async get(
    scope: OwnershipScope,
    automationId: string,
    version: number,
  ): Promise<WorkflowGraph | null> {
    const response = await this.dynamo.send(
      new GetCommand({
        TableName: this.dynamoConfig.tableName,
        Key: {
          pk: scopePartition(scope),
          sk: metadataSk(automationId, version),
        },
        ConsistentRead: true,
      }),
    );
    const metadata = parseMetadata(response.Item);
    if (!metadata) return null;
    if (metadata.automationId !== automationId || metadata.version !== version) {
      throw new Error("workflow metadata identity mismatch");
    }

    const bytes = await this.documents.get(metadata.objectKey);
    if (!bytes) throw new Error("workflow metadata points to a missing S3 document");
    const graph = decodeWorkflowDocument(bytes);
    this.assertGraphIdentity(graph, automationId, version, metadata.workflowId);
    return graph;
  }

  async putImmutable(
    scope: OwnershipScope,
    graph: WorkflowGraph,
  ): Promise<void> {
    assertWorkflowGraph(graph);
    const key = workflowObjectKey(
      scope,
      this.artifactConfig.prefix,
      graph.automationId,
      graph.version,
    );
    const bytes = canonicalWorkflowBytes(graph);

    const existingMetadata = await this.dynamo.send(
      new GetCommand({
        TableName: this.dynamoConfig.tableName,
        Key: {
          pk: scopePartition(scope),
          sk: metadataSk(graph.automationId, graph.version),
        },
        ConsistentRead: true,
      }),
    );
    if (parseMetadata(existingMetadata.Item)) {
      throw new Error(`workflow version ${graph.version} already exists`);
    }

    const writeResult = await this.documents.putIfAbsent(key, bytes);
    if (writeResult === "EXISTS") {
      const existingBytes = await this.documents.get(key);
      if (!existingBytes || !bytesEqual(existingBytes, bytes)) {
        throw new Error(
          `workflow version ${graph.version} conflicts with an existing immutable S3 document`,
        );
      }
    }

    const metadata: WorkflowMetadataItem = {
      pk: scopePartition(scope),
      sk: metadataSk(graph.automationId, graph.version),
      entity: "WORKFLOW_VERSION",
      automationId: graph.automationId,
      version: graph.version,
      workflowId: graph.workflowId,
      objectKey: key,
      createdAt: graph.createdAt,
      ...(graph.publishedAt ? { publishedAt: graph.publishedAt } : {}),
    };

    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.dynamoConfig.tableName,
          Item: metadata,
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": "pk" },
        }),
      );
    } catch (error) {
      if (isDynamoConditionalFailure(error)) {
        throw new Error(`workflow version ${graph.version} already exists`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  async list(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<readonly WorkflowGraph[]> {
    const metadata = await queryAllMetadata(
      this.dynamo,
      this.dynamoConfig.tableName,
      scope,
      automationId,
    );
    metadata.sort((left, right) => left.version - right.version);

    const graphs: WorkflowGraph[] = [];
    for (const item of metadata) {
      const bytes = await this.documents.get(item.objectKey);
      if (!bytes) {
        throw new Error(
          `workflow version ${item.version} metadata points to a missing S3 document`,
        );
      }
      const graph = decodeWorkflowDocument(bytes);
      this.assertGraphIdentity(graph, automationId, item.version, item.workflowId);
      graphs.push(graph);
    }
    return graphs;
  }

  private assertGraphIdentity(
    graph: WorkflowGraph,
    automationId: string,
    version: number,
    workflowId: string,
  ): void {
    if (
      graph.automationId !== automationId ||
      graph.version !== version ||
      graph.workflowId !== workflowId
    ) {
      throw new Error("S3 workflow document identity does not match DynamoDB metadata");
    }
  }
}
