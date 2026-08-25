import { describe, expect, it } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import { InMemoryCheckpointRepository, InMemoryRunRepository } from "./memory.js";
import type { ArtifactRef, ArtifactStore, OwnershipScope } from "./index.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import { RunEvidenceControlPlaneHttpHandler, RunEvidenceService } from "./run-evidence.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function run(): RunRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    occurrenceKey: "auto-1:2026-08-25T04:00:00.000Z",
    status: "FAILED",
    scheduledAt: "2026-08-25T04:00:00.000Z",
    startedAt: "2026-08-25T04:00:01.000Z",
    finishedAt: "2026-08-25T04:00:10.000Z",
  };
}

function checkpoint(refs: readonly string[]): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    currentNodeId: "submit-private-node-id",
    completedNodeIds: ["open-private-node-id"],
    attempt: 2,
    fingerprintRepeatCount: 1,
    variables: { password: "must-never-leave-server" },
    evidenceRefs: refs,
    updatedAt: "2026-08-25T04:00:10.000Z",
  };
}

class FakeArtifactStore implements ArtifactStore {
  reads = 0;
  constructor(private readonly values: Readonly<Record<string, Uint8Array | null>>) {}
  async put(): Promise<ArtifactRef> {
    throw new Error("not used");
  }
  async get(_scope: OwnershipScope, ref: string): Promise<Uint8Array | null> {
    this.reads += 1;
    return this.values[ref] ?? null;
  }
}

async function setup(values: Readonly<Record<string, Uint8Array | null>>, refs = Object.keys(values)) {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  await runs.createIfAbsent(run());
  await checkpoints.put(owner, checkpoint(refs));
  const artifacts = new FakeArtifactStore(values);
  return { service: new RunEvidenceService(runs, checkpoints, artifacts), artifacts };
}

describe("RunEvidenceService", () => {
  it("returns a bounded screenshot without exposing its durable artifact reference", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const { service } = await setup({ "aws-s3-artifact://private-ref": png });

    const view = await service.get(owner, "auto-1", "run-1", "1");

    expect(view).toMatchObject({
      kind: "SCREENSHOT",
      ordinal: 1,
      contentType: "image/png",
      sizeBytes: png.byteLength,
    });
    expect(view).not.toHaveProperty("ref");
    expect(JSON.stringify(view)).not.toContain("private-ref");
  });

  it("reduces browser metadata to a closed schema and removes fingerprints and extra payload", async () => {
    const metadata = new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      kind: "deterministic-after",
      nodeKind: "CLICK",
      sequence: 4,
      stateFingerprint: "private-page-fingerprint",
      origin: "https://example.com",
      rawText: "private page text",
    }));
    const { service } = await setup({ "aws-s3-artifact://metadata": metadata });

    const view = await service.get(owner, "auto-1", "run-1", "1");

    expect(view).toEqual({
      kind: "BROWSER_STATE",
      ordinal: 1,
      sizeBytes: metadata.byteLength,
      sequence: 4,
      eventKind: "deterministic-after",
      nodeKind: "CLICK",
      origin: "https://example.com",
    });
    expect(JSON.stringify(view)).not.toContain("fingerprint");
    expect(JSON.stringify(view)).not.toContain("private page text");
  });

  it("keeps unknown evidence opaque rather than returning raw bytes", async () => {
    const secret = new TextEncoder().encode("provider-secret-payload");
    const { service } = await setup({ "aws-s3-artifact://unknown": secret });

    const view = await service.get(owner, "auto-1", "run-1", "1");

    expect(view).toEqual({
      kind: "PROTECTED",
      ordinal: 1,
      sizeBytes: secret.byteLength,
      reason: "UNSUPPORTED_FORMAT",
    });
    expect(JSON.stringify(view)).not.toContain("provider-secret-payload");
  });

  it("rejects cross-tenant evidence access before reading artifact storage", async () => {
    const { service, artifacts } = await setup({
      "aws-s3-artifact://private-ref": Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });

    await expect(service.get(attacker, "auto-1", "run-1", "1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(artifacts.reads).toBe(0);
  });

  it("rejects forged ordinals before artifact storage", async () => {
    const { service, artifacts } = await setup({
      "aws-s3-artifact://private-ref": Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });

    await expect(service.get(owner, "auto-1", "run-1", "101")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(artifacts.reads).toBe(0);
  });
});

describe("RunEvidenceControlPlaneHttpHandler", () => {
  it("serves evidence only through the authenticated GET route", async () => {
    const { service } = await setup({
      "aws-s3-artifact://private-ref": Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    const base: ControlPlaneHttpHandlerPort = {
      async handle() {
        return { status: 418, body: { delegated: true } };
      },
    };
    const handler = new RunEvidenceControlPlaneHttpHandler(base, service);

    const response = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs/run-1/evidence/1" },
      { scope: owner },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: "SCREENSHOT", ordinal: 1 });
    expect(JSON.stringify(response.body)).not.toContain("private-ref");

    const mutation = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/runs/run-1/evidence/1", body: {} },
      { scope: owner },
    );
    expect(mutation.status).toBe(404);
  });
});
