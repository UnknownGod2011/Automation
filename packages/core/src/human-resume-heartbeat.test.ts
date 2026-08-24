import { describe, expect, it } from "vitest";
import type { HumanResumeExecutionLease } from "./human-resume-lease.js";
import { HumanResumeLeaseHeartbeat } from "./human-resume-heartbeat.js";

const lease = (expiresAt = "2026-08-19T00:01:00.000Z"): HumanResumeExecutionLease => ({
  tenantId: "tenant-1",
  userId: "user-1",
  runId: "run-1",
  nodeId: "human-1",
  resolutionId: "resolution-1",
  ownerToken: "worker-secret-token",
  state: "ACTIVE",
  acquiredAt: "2026-08-19T00:00:00.000Z",
  expiresAt,
});

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

describe("HumanResumeLeaseHeartbeat", () => {
  it("serializes concurrent renewals so lease state cannot regress", async () => {
    let activeRenewals = 0;
    let maxActiveRenewals = 0;
    let renewalCalls = 0;

    const heartbeat = new HumanResumeLeaseHeartbeat(
      lease(),
      async (current) => {
        renewalCalls += 1;
        activeRenewals += 1;
        maxActiveRenewals = Math.max(maxActiveRenewals, activeRenewals);
        await delay(5);
        activeRenewals -= 1;
        return {
          ...current,
          expiresAt: `2026-08-19T00:01:0${renewalCalls}.000Z`,
        };
      },
      1_000,
    );

    const [first, second, third] = await Promise.all([
      heartbeat.renewNow(),
      heartbeat.renewNow(),
      heartbeat.renewNow(),
    ]);

    expect(renewalCalls).toBe(1);
    expect(maxActiveRenewals).toBe(1);
    expect(first.expiresAt).toBe(second.expiresAt);
    expect(second.expiresAt).toBe(third.expiresAt);
  });

  it("renews during a long operation and permanently fences later work after ownership loss", async () => {
    let renewalCalls = 0;
    let laterOperationCalls = 0;
    const heartbeat = new HumanResumeLeaseHeartbeat(
      lease(),
      async (current) => {
        renewalCalls += 1;
        if (renewalCalls >= 3) {
          throw new Error("conditional renewal rejected");
        }
        return {
          ...current,
          expiresAt: `2026-08-19T00:01:0${renewalCalls}.000Z`,
        };
      },
      5,
    );

    heartbeat.start();
    await expect(
      heartbeat.runFenced(async () => {
        await delay(25);
        return "completed";
      }),
    ).rejects.toThrow("heartbeat lost ownership");

    await expect(
      heartbeat.runFenced(async () => {
        laterOperationCalls += 1;
        return "must not run";
      }),
    ).rejects.toThrow("heartbeat lost ownership");

    await heartbeat.stop();
    expect(renewalCalls).toBeGreaterThanOrEqual(3);
    expect(laterOperationCalls).toBe(0);
  });

  it("treats uncertain renewal failure as permanent ownership loss without leaking the owner token", async () => {
    const heartbeat = new HumanResumeLeaseHeartbeat(
      lease(),
      async () => {
        throw new Error("transport failed for worker-secret-token");
      },
      1_000,
    );

    let message = "";
    try {
      await heartbeat.renewNow();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("heartbeat lost ownership");
    expect(message).not.toContain("worker-secret-token");
    expect(() => heartbeat.assertOwned()).toThrow("heartbeat lost ownership");
  });

  it("rejects invalid heartbeat intervals", () => {
    expect(() => new HumanResumeLeaseHeartbeat(lease(), async (value) => value, 0)).toThrow(
      "positive safe integer",
    );
  });
});
