import { describe, expect, it, vi } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import type { HumanResolutionClaimResult, ValidatedHumanResolution } from "./human-resolution.js";
import {
  InMemoryHumanResumeEffectReconciliationStore,
} from "./human-resume-effect.js";
import {
  InMemoryHumanResumeExecutionLeaseStore,
} from "./human-resume-lease.js";
import { HumanResumeRecoveryAdmission } from "./human-resume-recovery.js";

const command = {
  scope: { tenantId: "tenant-1", userId: "user-1" },
  runId: "run-1",
  expectedNodeId: "human-1",
  resolutionId: "resolution-1",
};

const run: RunRecord = {
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  automationId: "automation-1",
  workflowVersion: 1,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-19T00:00:00.000Z",
  currentNodeId: "human-1",
};

const checkpoint: RunCheckpoint = {
  runId: "run-1",
  automationId: "automation-1",
  workflowVersion: 1,
  currentNodeId: "human-1",
  completedNodeIds: [],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: {},
  evidenceRefs: [],
  updatedAt: "2026-08-19T00:00:00.000Z",
};

function validated(status: HumanResolutionClaimResult["status"]): ValidatedHumanResolution {
  const result = {
    status,
    claim: {
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      nodeId: "human-1",
      resolutionId: status === "CONFLICT" ? "other-resolution" : "resolution-1",
      acceptedAt: "2026-08-19T00:00:00.000Z",
    },
  } as HumanResolutionClaimResult;
  return { result, run, checkpoint };
}

async function prepareEffect(store: InMemoryHumanResumeEffectReconciliationStore, resolutionId = "resolution-1") {
  await store.prepare(
    {
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      humanNodeId: "human-1",
      successorNodeId: "click-1",
      resolutionId,
      effectId: "effect-1",
    },
    "2026-08-19T00:00:00.000Z",
  );
}

describe("HumanResumeRecoveryAdmission", () => {
  it("reacquires expired same-resolution ownership for reconciliation only", async () => {
    const effects = new InMemoryHumanResumeEffectReconciliationStore();
    const leases = new InMemoryHumanResumeExecutionLeaseStore();
    await prepareEffect(effects);
    await leases.acquire(command, "old-owner", "2026-08-19T00:00:00.000Z", 1_000);

    const admission = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("REPLAY")) },
      effects,
      leases,
      ownerToken: () => "replacement-owner",
      leaseTtlMs: 1_000,
      now: () => new Date("2026-08-19T00:00:02.000Z"),
    });

    const result = await admission.admit(command);
    expect(result.kind).toBe("RECONCILIATION_OWNERSHIP_ACQUIRED");
    if (result.kind !== "RECONCILIATION_OWNERSHIP_ACQUIRED") throw new Error("unexpected result");
    expect(result.lease.ownerToken).toBe("replacement-owner");
    expect(result.effect.effectId).toBe("effect-1");
  });

  it("does not steal a live lease", async () => {
    const effects = new InMemoryHumanResumeEffectReconciliationStore();
    const leases = new InMemoryHumanResumeExecutionLeaseStore();
    await prepareEffect(effects);
    await leases.acquire(command, "live-owner", "2026-08-19T00:00:00.000Z", 10_000);

    const admission = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("REPLAY")) },
      effects,
      leases,
      ownerToken: () => "replacement-owner",
      leaseTtlMs: 1_000,
      now: () => new Date("2026-08-19T00:00:02.000Z"),
    });

    const result = await admission.admit(command);
    expect(result.kind).toBe("LEASE_NOT_ACQUIRED");
    if (result.kind !== "LEASE_NOT_ACQUIRED") throw new Error("unexpected result");
    expect(result.lease.status).toBe("BUSY");
  });

  it("does not acquire recovery ownership when no effect was durably prepared", async () => {
    const effects = new InMemoryHumanResumeEffectReconciliationStore();
    const acquire = vi.fn();
    const admission = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("REPLAY")) },
      effects,
      leases: { acquire, renew: vi.fn(), complete: vi.fn(), get: vi.fn() },
      ownerToken: () => "replacement-owner",
      leaseTtlMs: 1_000,
    });

    const result = await admission.admit(command);
    expect(result.kind).toBe("NO_EFFECT_PREPARED");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("rejects a durable effect from a different resolution before lease acquisition", async () => {
    const effects = new InMemoryHumanResumeEffectReconciliationStore();
    await prepareEffect(effects, "other-resolution");
    const acquire = vi.fn();
    const admission = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("REPLAY")) },
      effects,
      leases: { acquire, renew: vi.fn(), complete: vi.fn(), get: vi.fn() },
      ownerToken: () => "replacement-owner",
      leaseTtlMs: 1_000,
    });

    await expect(admission.admit(command)).rejects.toThrow("does not match replayed resolution boundary");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("keeps fresh and conflicting claims out of the recovery path", async () => {
    const effects = new InMemoryHumanResumeEffectReconciliationStore();
    const leases = new InMemoryHumanResumeExecutionLeaseStore();

    const fresh = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("ACCEPTED")) },
      effects,
      leases,
      ownerToken: () => "owner",
      leaseTtlMs: 1_000,
    });
    await expect(fresh.admit(command)).resolves.toMatchObject({ kind: "FRESH_RESOLUTION" });

    const conflict = new HumanResumeRecoveryAdmission({
      resolutions: { claim: vi.fn(async () => validated("CONFLICT")) },
      effects,
      leases,
      ownerToken: () => "owner",
      leaseTtlMs: 1_000,
    });
    await expect(conflict.admit(command)).resolves.toMatchObject({ kind: "CLAIM_CONFLICT" });
  });
});
