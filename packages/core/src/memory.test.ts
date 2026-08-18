import { describe, expect, it } from "vitest";
import type { RunRecord, WorkflowGraph } from "@automation/contracts";
import {
  InMemoryAutomationLockManager,
  InMemoryCredentialVault,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const graph = (version = 1): WorkflowGraph => ({
  schemaVersion: 1,
  workflowId: `wf-${version}`,
  automationId: "auto-1",
  version,
  entryNodeId: "done",
  objective: "Complete the job",
  createdAt: "2026-08-18T00:00:00.000Z",
  nodes: {
    done: {
      id: "done",
      kind: "END",
      objective: "Finish",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        jitter: false,
        retryableFailureCodes: [],
      },
      timeoutMs: 1_000,
      escalation: "FAIL",
    },
  },
});

const run = (runId: string, occurrenceKey: string): RunRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId,
  automationId: "auto-1",
  workflowVersion: 1,
  occurrenceKey,
  status: "QUEUED",
  scheduledAt: "2026-08-18T12:00:00.000Z",
});

describe("InMemoryWorkflowVersionRepository", () => {
  it("never overwrites a published version key", async () => {
    const repository = new InMemoryWorkflowVersionRepository();
    await repository.putImmutable(scope, graph(1));

    await expect(repository.putImmutable(scope, graph(1))).rejects.toThrow(/already exists/);
    expect((await repository.get(scope, "auto-1", 1))?.workflowId).toBe("wf-1");
  });

  it("lists versions in ascending order", async () => {
    const repository = new InMemoryWorkflowVersionRepository();
    await repository.putImmutable(scope, graph(2));
    await repository.putImmutable(scope, graph(1));

    expect((await repository.list(scope, "auto-1")).map((item) => item.version)).toEqual([1, 2]);
  });
});

describe("InMemoryRunRepository", () => {
  it("deduplicates at-least-once delivery by occurrence key", async () => {
    const repository = new InMemoryRunRepository();
    const first = await repository.createIfAbsent(run("run-1", "auto-1:2026-08-18T12:00:00.000Z"));
    const duplicate = await repository.createIfAbsent(
      run("run-2", "auto-1:2026-08-18T12:00:00.000Z"),
    );

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.run.runId).toBe("run-1");
  });

  it("protects immutable run identity fields", async () => {
    const repository = new InMemoryRunRepository();
    const original = run("run-1", "occurrence-1");
    await repository.createIfAbsent(original);

    await expect(
      repository.update({ ...original, automationId: "other-automation" }),
    ).rejects.toThrow(/immutable run identity/);
  });
});

describe("InMemoryAutomationLockManager", () => {
  it("prevents concurrent owners until the lease expires", async () => {
    let nowMs = Date.parse("2026-08-18T12:00:00.000Z");
    const manager = new InMemoryAutomationLockManager(() => new Date(nowMs));

    const first = await manager.acquire(scope, "auto-1", "run-1", 1_000);
    expect(first).not.toBeNull();
    expect(await manager.acquire(scope, "auto-1", "run-2", 1_000)).toBeNull();

    nowMs += 1_001;
    expect(await manager.acquire(scope, "auto-1", "run-2", 1_000)).not.toBeNull();
  });

  it("does not allow another owner to release a lease", async () => {
    const manager = new InMemoryAutomationLockManager();
    const lease = await manager.acquire(scope, "auto-1", "run-1", 1_000);
    if (!lease) throw new Error("expected lock lease");

    await expect(
      manager.release(scope, { ...lease, ownerToken: "run-2" }),
    ).rejects.toThrow(/not owned/);
  });
});

describe("InMemoryCredentialVault", () => {
  it("isolates secret references by ownership scope", async () => {
    const vault = new InMemoryCredentialVault();
    const secretRef = await vault.put(scope, "cred-1", { value: "super-secret" });

    expect((await vault.get(scope, secretRef))?.value).toBe("super-secret");
    expect(
      await vault.get({ tenantId: "tenant-2", userId: "user-2" }, secretRef),
    ).toBeNull();
  });
});
