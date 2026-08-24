import { describe, expect, it } from "vitest";
import {
  AwsArtifactStoreConfigurationPreflightCheck,
  AwsS3ArtifactStore,
  loadAwsArtifactStoreConfig,
  type S3ArtifactApi,
} from "./index.js";

class FakeS3Api implements S3ArtifactApi {
  readonly puts: {
    key: string;
    content: Uint8Array;
    contentType: string;
  }[] = [];
  readonly gets: string[] = [];
  objects = new Map<string, Uint8Array>();

  async put(key: string, content: Uint8Array, contentType: string) {
    this.puts.push({ key, content: Uint8Array.from(content), contentType });
    this.objects.set(key, Uint8Array.from(content));
  }

  async get(key: string) {
    this.gets.push(key);
    const value = this.objects.get(key);
    return value ? Uint8Array.from(value) : null;
  }
}

describe("AwsS3ArtifactStore", () => {
  it("stores evidence under an opaque ownership-scoped key", async () => {
    const api = new FakeS3Api();
    const store = new AwsS3ArtifactStore(api, "automation/evidence");
    const scope = { tenantId: "tenant-1", userId: "user-1" };
    const bytes = new TextEncoder().encode("evidence");

    const artifact = await store.put(
      scope,
      "runs/run-1/screenshot.png",
      bytes,
      "image/png",
    );

    expect(artifact.ref).toMatch(/^aws-s3-artifact:\/\//);
    expect(artifact.sizeBytes).toBe(bytes.byteLength);
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]?.key).not.toContain(scope.tenantId);
    expect(api.puts[0]?.key).not.toContain(scope.userId);
    expect(api.puts[0]?.key).toContain("runs/run-1/screenshot.png");
    expect(await store.get(scope, artifact.ref)).toEqual(bytes);
  });

  it("uses different storage prefixes for different ownership scopes", async () => {
    const api = new FakeS3Api();
    const store = new AwsS3ArtifactStore(api);
    const bytes = new Uint8Array([1]);

    await store.put(
      { tenantId: "tenant-1", userId: "user-1" },
      "same/path",
      bytes,
      "application/octet-stream",
    );
    await store.put(
      { tenantId: "tenant-2", userId: "user-2" },
      "same/path",
      bytes,
      "application/octet-stream",
    );

    expect(api.puts[0]?.key).not.toBe(api.puts[1]?.key);
  });

  it("rejects cross-tenant artifact references before issuing an S3 read", async () => {
    const api = new FakeS3Api();
    const store = new AwsS3ArtifactStore(api);
    const owner = { tenantId: "tenant-1", userId: "user-1" };
    const other = { tenantId: "tenant-2", userId: "user-2" };
    const artifact = await store.put(
      owner,
      "run/evidence.json",
      new Uint8Array([1, 2]),
      "application/json",
    );

    await expect(store.get(other, artifact.ref)).rejects.toThrow(/outside the authorized ownership scope/);
    expect(api.gets).toHaveLength(0);
  });

  it("rejects unsafe path segments before cloud calls", async () => {
    const api = new FakeS3Api();
    const store = new AwsS3ArtifactStore(api);

    await expect(
      store.put(
        { tenantId: "tenant-1", userId: "user-1" },
        "../other-tenant/object",
        new Uint8Array([1]),
        "application/octet-stream",
      ),
    ).rejects.toThrow(/unsafe path segment/);
    expect(api.puts).toHaveLength(0);
  });
});

describe("AWS artifact store configuration", () => {
  it("requires an explicit bucket and supports optional customer-managed KMS", () => {
    const missing = loadAwsArtifactStoreConfig({});
    expect(missing.configured).toBe(false);

    const configured = loadAwsArtifactStoreConfig({
      AWS_ARTIFACT_BUCKET: "automation-prod-artifacts",
      AWS_ARTIFACT_PREFIX: "platform/evidence",
      AWS_ARTIFACT_KMS_KEY_ID: "arn:aws:kms:region:account:key/example",
    });
    expect(configured.configured).toBe(true);
    if (!configured.configured) throw new Error("expected configured result");
    expect(configured.config).toEqual({
      bucket: "automation-prod-artifacts",
      prefix: "platform/evidence",
      kmsKeyId: "arn:aws:kms:region:account:key/example",
    });
  });

  it("turns missing storage configuration into a neutral preflight blocker", async () => {
    const check = new AwsArtifactStoreConfigurationPreflightCheck(
      loadAwsArtifactStoreConfig({}),
    );
    const result = await check.check();
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("expected blocked preflight");
    expect(result.failure.code).toBe("NOT_CONFIGURED");
  });
});
