import { describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "@automation/contracts";
import {
  InMemoryHumanResumeEffectReconciliationStore,
  type HumanResumeEffectIdentity,
} from "./human-resume-effect.js";
import {
  HumanResumeEffectReconciler,
  type HumanResumeEffectVerifier,
} from "./human-resume-reconciliation.js";

const identity = (overrides: Partial<HumanResumeEffectIdentity> = {}): HumanResumeEffectIdentity => ({
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  humanNodeId: "human-1",
  successorNodeId: "click-1",
  resolutionId: "resolution-1",
  effectId: "effect-1",
  ...overrides,
});

const node = (overrides: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: "click-1",
  kind: "CLICK",
  objective: "submit the repaired form",
  deterministicStrategies: [{ kind: "ROLE", value: "button:Submit" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["submit-form"],
  verification: {
    description: "confirmation is visible",
    mode: "TEXT",
    expected: "Submitted",
    timeoutMs: 5_000,
  },
  retryPolicy: {
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
    jitter: false,
    retryableFailureCodes: [],
  },
  timeoutMs: 10_000,
  next: ["end"],
  escalation: "HUMAN",
  ...overrides,
});

const verifier = (decision: "ALREADY_APPLIED" | "DEFINITELY_NOT_APPLIED" | "AMBIGUOUS") => ({
  inspect: vi.fn(async () => ({ decision, evidenceRefs: ["evidence/reconcile-1"] })),
}) satisfies HumanResumeEffectVerifier;

describe("HumanResumeEffectReconciler", () => {
  it("prepares before read-only inspection and persists the verifier decision", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    const effectVerifier = verifier("ALREADY_APPLIED");
    const reconciler = new HumanResumeEffectReconciler({
      store,
      verifier: effectVerifier,
      now: () => new Date("2026-08-19T03:00:00.000Z"),
    });

    const result = await reconciler.reconcile(identity(), node());

    expect(result.status).toBe("DECIDED");
    expect(result.record.decision).toBe("ALREADY_APPLIED");
    expect(result.evidenceRefs).toEqual(["evidence/reconcile-1"]);
    expect(effectVerifier.inspect).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: "tenant-1", userId: "user-1" },
      runId: "run-1",
      humanNodeId: "human-1",
      resolutionId: "resolution-1",
      effectId: "effect-1",
      node: expect.objectContaining({ id: "click-1" }),
      verification: expect.objectContaining({ expected: "Submitted" }),
    }));

    const durable = await store.get({ tenantId: "tenant-1", userId: "user-1" }, "run-1", "human-1");
    expect(durable?.state).toBe("DECIDED");
    expect(durable?.decision).toBe("ALREADY_APPLIED");
  });

  it("returns an existing durable decision without re-inspecting runtime state", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await store.prepare(identity(), "2026-08-19T02:59:00.000Z");
    await store.decide(identity(), "AMBIGUOUS", "2026-08-19T02:59:01.000Z");
    const effectVerifier = verifier("DEFINITELY_NOT_APPLIED");
    const reconciler = new HumanResumeEffectReconciler({ store, verifier: effectVerifier });

    const result = await reconciler.reconcile(identity(), node());

    expect(result.status).toBe("REPLAY");
    expect(result.record.decision).toBe("AMBIGUOUS");
    expect(effectVerifier.inspect).not.toHaveBeenCalled();
  });

  it("rejects a competing prepared identity before invoking the verifier", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await store.prepare(identity(), "2026-08-19T02:59:00.000Z");
    const effectVerifier = verifier("DEFINITELY_NOT_APPLIED");
    const reconciler = new HumanResumeEffectReconciler({ store, verifier: effectVerifier });

    const result = await reconciler.reconcile(identity({ effectId: "effect-2" }), node());

    expect(result.status).toBe("CONFLICT");
    expect(result.record.effectId).toBe("effect-1");
    expect(effectVerifier.inspect).not.toHaveBeenCalled();
  });

  it("leaves the prepared authority undecided when inspection fails", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    const effectVerifier: HumanResumeEffectVerifier = {
      inspect: vi.fn(async () => {
        throw new Error("inspection transport uncertain");
      }),
    };
    const reconciler = new HumanResumeEffectReconciler({ store, verifier: effectVerifier });

    await expect(reconciler.reconcile(identity(), node())).rejects.toThrow("inspection transport uncertain");

    const durable = await store.get({ tenantId: "tenant-1", userId: "user-1" }, "run-1", "human-1");
    expect(durable?.state).toBe("PREPARED");
    expect(durable?.decision).toBeUndefined();
  });

  it("fails closed before inspection for mismatched or non-verifiable successors", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    const effectVerifier = verifier("DEFINITELY_NOT_APPLIED");
    const reconciler = new HumanResumeEffectReconciler({ store, verifier: effectVerifier });

    await expect(reconciler.reconcile(identity(), node({ id: "other" }))).rejects.toThrow(
      "does not match prepared successor identity",
    );
    await expect(
      reconciler.reconcile(identity(), node({ allowedSideEffects: [], verification: undefined })),
    ).rejects.toThrow("only valid for a side-effecting successor");
    expect(effectVerifier.inspect).not.toHaveBeenCalled();
  });

  it("persists ambiguity instead of converting uncertainty into retry permission", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    const reconciler = new HumanResumeEffectReconciler({ store, verifier: verifier("AMBIGUOUS") });

    const result = await reconciler.reconcile(identity(), node());

    expect(result.status).toBe("DECIDED");
    expect(result.record.decision).toBe("AMBIGUOUS");
  });

  it("lets the durable first decision win when read-only inspections race", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstVerifier: HumanResumeEffectVerifier = {
      inspect: vi.fn(async () => {
        releaseSecond();
        return { decision: "ALREADY_APPLIED", evidenceRefs: ["evidence/first"] };
      }),
    };
    const secondVerifier: HumanResumeEffectVerifier = {
      inspect: vi.fn(async () => {
        await secondGate;
        return { decision: "DEFINITELY_NOT_APPLIED", evidenceRefs: ["evidence/second"] };
      }),
    };

    const first = new HumanResumeEffectReconciler({ store, verifier: firstVerifier });
    const second = new HumanResumeEffectReconciler({ store, verifier: secondVerifier });
    const [a, b] = await Promise.all([
      first.reconcile(identity(), node()),
      second.reconcile(identity(), node()),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["CONFLICT", "DECIDED"]);
    const durable = await store.get({ tenantId: "tenant-1", userId: "user-1" }, "run-1", "human-1");
    expect(durable?.state).toBe("DECIDED");
    expect(["ALREADY_APPLIED", "DEFINITELY_NOT_APPLIED"]).toContain(durable?.decision);
  });
});
