import { describe, expect, it } from "vitest";
import {
  InMemoryHumanResumeEffectReconciliationStore,
  humanResumeEffectRetryAllowed,
  type HumanResumeEffectIdentity,
} from "./human-resume-effect.js";

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

describe("InMemoryHumanResumeEffectReconciliationStore", () => {
  it("prepares one immutable effect identity and replays the same identity", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    const first = await store.prepare(identity(), "2026-08-19T02:00:00.000Z");
    const replay = await store.prepare(identity(), "2026-08-19T02:00:01.000Z");

    expect(first.status).toBe("PREPARED");
    expect(replay.status).toBe("REPLAY");
    expect(replay.record.preparedAt).toBe("2026-08-19T02:00:00.000Z");
  });

  it("rejects a competing effect identity for the same pause boundary", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    const conflict = await store.prepare(
      identity({ effectId: "effect-2" }),
      "2026-08-19T02:00:01.000Z",
    );
    expect(conflict.status).toBe("CONFLICT");
    expect(conflict.record.effectId).toBe("effect-1");
  });

  it("persists exactly one immutable reconciliation decision", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    const decided = await store.decide(
      identity(),
      "DEFINITELY_NOT_APPLIED",
      "2026-08-19T02:00:02.000Z",
    );
    const replay = await store.decide(
      identity(),
      "DEFINITELY_NOT_APPLIED",
      "2026-08-19T02:00:03.000Z",
    );
    const conflict = await store.decide(
      identity(),
      "ALREADY_APPLIED",
      "2026-08-19T02:00:04.000Z",
    );

    expect(decided.status).toBe("DECIDED");
    expect(replay.status).toBe("REPLAY");
    expect(conflict.status).toBe("CONFLICT");
    expect(conflict.record.decision).toBe("DEFINITELY_NOT_APPLIED");
  });

  it("isolates records by tenant and user scope", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await store.prepare(identity(), "2026-08-19T02:00:00.000Z");

    expect(await store.get({ tenantId: "tenant-2", userId: "user-1" }, "run-1", "human-1")).toBeNull();
    expect(await store.get({ tenantId: "tenant-1", userId: "user-2" }, "run-1", "human-1")).toBeNull();
    expect(await store.get({ tenantId: "tenant-1", userId: "user-1" }, "run-1", "human-1")).not.toBeNull();
  });

  it("requires prepare before deciding", async () => {
    const store = new InMemoryHumanResumeEffectReconciliationStore();
    await expect(
      store.decide(identity(), "AMBIGUOUS", "2026-08-19T02:00:00.000Z"),
    ).rejects.toThrow("must be prepared");
  });
});

describe("humanResumeEffectRetryAllowed", () => {
  it("allows retry only when verification proves the effect did not happen", () => {
    expect(humanResumeEffectRetryAllowed("DEFINITELY_NOT_APPLIED")).toBe(true);
    expect(humanResumeEffectRetryAllowed("ALREADY_APPLIED")).toBe(false);
    expect(humanResumeEffectRetryAllowed("AMBIGUOUS")).toBe(false);
  });
});
