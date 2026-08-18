import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type {
  ArtifactRef,
  ArtifactStore,
  OwnershipScope,
  RunPreflightCheck,
  RunPreflightCheckResult,
} from "@automation/core";
import { scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const ARTIFACT_REF_PREFIX = "aws-s3-artifact://";
const DEFAULT_ARTIFACT_PREFIX = "automation";

export interface AwsArtifactStoreConfig {
  bucket: string;
  prefix: string;
  kmsKeyId?: string;
}

export type AwsArtifactStoreConfigResult =
  | { configured: true; config: AwsArtifactStoreConfig }
  | { configured: false; missing: readonly string[]; message: string };

export interface S3ArtifactApi {
  put(
    key: string,
    content: Uint8Array,
    contentType: string,
  ): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

function normalizePath(path: string, label: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized) throw new Error(`${label} is required`);
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return segments.join("/");
}

function scopePrefix(scope: OwnershipScope, prefix: string): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "artifacts"));
  return `${normalizePath(prefix, "artifact prefix")}/${digest.slice(0, 32)}`;
}

function artifactKey(
  scope: OwnershipScope,
  prefix: string,
  path: string,
): string {
  return `${scopePrefix(scope, prefix)}/${normalizePath(path, "artifact path")}`;
}

function artifactRef(key: string): string {
  return `${ARTIFACT_REF_PREFIX}${encodeURIComponent(key)}`;
}

function parseArtifactRef(
  scope: OwnershipScope,
  prefix: string,
  ref: string,
): string {
  if (!ref.startsWith(ARTIFACT_REF_PREFIX)) {
    throw new Error("artifact reference does not belong to the AWS S3 adapter");
  }

  let key: string;
  try {
    key = decodeURIComponent(ref.slice(ARTIFACT_REF_PREFIX.length));
  } catch {
    throw new Error("invalid AWS S3 artifact reference encoding");
  }

  const expectedPrefix = `${scopePrefix(scope, prefix)}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new Error("artifact reference is outside the authorized ownership scope");
  }
  normalizePath(key.slice(expectedPrefix.length), "artifact reference path");
  return key;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : undefined;
  const metadata = "$metadata" in error
    ? (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
    : undefined;
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    metadata?.httpStatusCode === 404
  );
}

export function loadAwsArtifactStoreConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsArtifactStoreConfigResult {
  const bucket = env.AWS_ARTIFACT_BUCKET?.trim();
  if (!bucket) {
    return {
      configured: false,
      missing: ["AWS_ARTIFACT_BUCKET"],
      message: "AWS artifact store is not configured: missing AWS_ARTIFACT_BUCKET",
    };
  }

  return {
    configured: true,
    config: {
      bucket,
      prefix: normalizePath(
        env.AWS_ARTIFACT_PREFIX?.trim() || DEFAULT_ARTIFACT_PREFIX,
        "artifact prefix",
      ),
      ...(env.AWS_ARTIFACT_KMS_KEY_ID?.trim()
        ? { kmsKeyId: env.AWS_ARTIFACT_KMS_KEY_ID.trim() }
        : {}),
    },
  };
}

export class AwsArtifactStoreConfigurationPreflightCheck
  implements RunPreflightCheck
{
  constructor(private readonly result: AwsArtifactStoreConfigResult) {}

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

export class AwsSdkS3ArtifactApi implements S3ArtifactApi {
  private readonly client: S3Client;

  constructor(
    private readonly config: AwsArtifactStoreConfig,
    clientConfig: S3ClientConfig | S3Client,
  ) {
    this.client =
      clientConfig instanceof S3Client
        ? clientConfig
        : new S3Client(clientConfig);
  }

  async put(
    key: string,
    content: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        ServerSideEncryption: "aws:kms",
        ...(this.config.kmsKeyId
          ? { SSEKMSKeyId: this.config.kmsKeyId }
          : {}),
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      if (!response.Body) return new Uint8Array();
      return Uint8Array.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

export class AwsS3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly api: S3ArtifactApi,
    private readonly prefix = DEFAULT_ARTIFACT_PREFIX,
  ) {
    normalizePath(prefix, "artifact prefix");
  }

  async put(
    scope: OwnershipScope,
    path: string,
    content: Uint8Array,
    contentType: string,
  ): Promise<ArtifactRef> {
    if (!contentType.trim()) throw new Error("artifact contentType is required");
    const key = artifactKey(scope, this.prefix, path);
    await this.api.put(key, content, contentType);
    return {
      ref: artifactRef(key),
      contentType,
      sizeBytes: content.byteLength,
    };
  }

  async get(scope: OwnershipScope, ref: string): Promise<Uint8Array | null> {
    const key = parseArtifactRef(scope, this.prefix, ref);
    return this.api.get(key);
  }
}
