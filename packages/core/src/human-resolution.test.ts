import { describe, expect, it } from "vitest";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";
import {
  HumanResolutionCoordinator,
  InMemoryCheckpointRepository,
  InMemoryHumanResolutionClaimStore,
  InMemoryRunRepository,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const waitingRun = (): RunRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 3,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-19T00:00:00.000Z",
  startedAt: "2026-08-19T00:00:01.000Z",
  currentNodeId: "human-1",
});

const checkpoint = (): RunCheckpoint => ({
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 3,
  currentNodeId: "human-1",
  completedNodeIds: ["click-1"],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: { reportId: "R-42" },
  evidenceRefs: ["evidence://before-human"],
  updatedAt: "2026-08-19T00:00:02.000Z",
});

async function setup() {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const run = waitingRun();
  await runs.createIfAbsent(run);
  await checkpoints.put(scope, checkpoint());
  const claims = new InMemoryHumanResolutionClaimStore();
  const coordinator = new HumanResolutionCoordinator({
    runs,
    checkpoints,
    claims,
    now: () => new Date("2026-08-19T00:00:03.000Z"),
  });
  return { coordinator, claims, runs };
}

describe("HumanResolutionCoordinator", () => {
  it("accepts exactly one resolution and treats an identical delivery as a replay", async () => {
    const { coordinator } = await setup();
    const command = {
      scope,
      runId: "run-1",
      expectedNodeId: "human-1",
      resolutionId: "resolution-1",
    };

    const first = await coordinator.claim(command);
    const second = await coordinator.claim(command);

    expect(first.result.status).toBe("ACCEPTED");
    expect(first.result.claim.acceptedAt).toBe("2026-08-19T00:00:03.000Z");
    expect(second.result.status).toBe("REPLAY");
    expect(second.result.claim).toEqual(first.result.claim);
  });

  it("serializes concurrent competing resolution IDs at the same run/node boundary", async () => {
    const { coordinator } = await setup();
    const [left, right] = await Promise.all([
      coordinator.claim({
        scope,
        runId: "run-1",
        expectedNodeId: "human-1",
        resolutionId: "resolution-a",
      }),
      coordinator.claim({
        scope,
        runId: "run-1",
        expectedNodeId: "human-1",
        resolutionId: "resolution-b",
      }),
    ]);

    expect([left.result.status, right.result.status].sort()).toEqual([
      "ACCEPTED",
      "CONFLICT",
    ]);
    expect(left.result.claim.resolutionId).toBe(right.result.claim.resolutionId);
  });

  it("rejects stale node commands before creating a claim", async () => {
    const { coordinator, claims } = await setup();

    await expect(
      coordinator.claim({
        scope,
        runId: "run-1",
        expectedNodeId: "human-old",
        resolutionId: "resolution-1",
      }),
    ).rejects.toThrow("durable checkpoint is 'human-1'");

    await expect(claims.get(scope, "run-1", "human-old")).resolves.toBeNull();
  });

  it("rejects cross-tenant resolution attempts without revealing or claiming the run", async () => {
    const { coordinator, claims } = await setup();
    const otherScope = { tenantId: "tenant-2", userId: "user-1" };

    await expect(
      coordinator.claim({
        scope: otherScope,
        runId: "run-1",
        expectedNodeId: "human-1",
        resolutionId: "resolution-1",
      }),
    ).rejects.toThrow("does not exist in the requested scope");

    await expect(claims.get(otherScope, "run-1", "human-1")).resolves.toBeNull();
  });

  it("rejects commands after the run has already left WAITING_FOR_HUMAN", async () => {
    const { coordinator, runs } = await setup();
    await runs.update({ ...waitingRun(), status: "RUNNING" });

    await expect(
      coordinator.claim({
        scope,
        runId: "run-1",
        expectedNodeId: "human-1",
        resolutionId: "resolution-1",
      }),
    ).rejects.toThrow("is not waiting for human resolution");
  });
});
