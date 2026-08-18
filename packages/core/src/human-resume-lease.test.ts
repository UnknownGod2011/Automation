import { describe, expect, it } from "vitest";
import {
  InMemoryHumanResumeExecutionLeaseStore,
  type HumanResolutionCommand,
} from "./index.js";

const command = (resolutionId = "resolution-1"): HumanResolutionCommand => ({
  scope: { tenantId: "tenant-1", userId: "user-1" },
  runId: "run-1",
  expectedNodeId: "human-1",
  resolutionId,
});

describe("InMemoryHumanResumeExecutionLeaseStore", () => {
  it("acquires one owner and rejects overlapping ownership", async () => {
    const store = new InMemoryHumanResumeExecutionLeaseStore();

    const first = await store.acquire(
      command(),
      "worker-a",
      "2026-08-19T00:00:00.000Z",
      30_000,
    );
    const second = await store.acquire(
      command(),
      "worker-b",
      "2026-08-19T00:00:01.000Z",
      30_000,
    );

    expect(first.status).toBe("ACQUIRED");
    expect(second).toMatchObject({ status: "BUSY", lease: { ownerToken: "worker-a" } });
  });

  it("allows only the same resolution to reacquire after expiry", async () => {
    const store = new InMemoryHumanResumeExecutionLeaseStore();
    await store.acquire(command(), "worker-a", "2026-08-19T00:00:00.000Z", 1_000);

    const conflict = await store.acquire(
      command("resolution-2"),
      "worker-b",
      "2026-08-19T00:00:02.000Z",
      1_000,
    );
    const recovered = await store.acquire(
      command(),
      "worker-c",
      "2026-08-19T00:00:02.000Z",
      1_000,
    );

    expect(conflict.status).toBe("CONFLICT");
    expect(recovered).toMatchObject({ status: "ACQUIRED", lease: { ownerToken: "worker-c" } });
  });

  it("renews only live ownership and completion becomes a permanent tombstone", async () => {
    const store = new InMemoryHumanResumeExecutionLeaseStore();
    const acquired = await store.acquire(
      command(),
      "worker-a",
      "2026-08-19T00:00:00.000Z",
      5_000,
    );
    if (acquired.status !== "ACQUIRED") throw new Error("expected acquisition");

    const renewed = await store.renew(
      acquired.lease,
      "2026-08-19T00:00:02.000Z",
      5_000,
    );
    expect(renewed?.expiresAt).toBe("2026-08-19T00:00:07.000Z");
    if (!renewed) throw new Error("expected renewal");

    const completed = await store.complete(renewed, "2026-08-19T00:00:03.000Z");
    expect(completed).toMatchObject({ state: "COMPLETED", completedAt: "2026-08-19T00:00:03.000Z" });

    const replay = await store.acquire(
      command(),
      "worker-b",
      "2026-08-19T00:00:20.000Z",
      5_000,
    );
    expect(replay.status).toBe("COMPLETED");
  });

  it("rejects renewal or completion after lease expiry", async () => {
    const store = new InMemoryHumanResumeExecutionLeaseStore();
    const acquired = await store.acquire(
      command(),
      "worker-a",
      "2026-08-19T00:00:00.000Z",
      1_000,
    );
    if (acquired.status !== "ACQUIRED") throw new Error("expected acquisition");

    expect(
      await store.renew(acquired.lease, "2026-08-19T00:00:01.000Z", 1_000),
    ).toBeNull();
    expect(
      await store.complete(acquired.lease, "2026-08-19T00:00:01.000Z"),
    ).toBeNull();
  });
});
