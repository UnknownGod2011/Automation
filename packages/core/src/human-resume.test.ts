import { describe, expect, it } from "vitest";
import type { ExecutionResult, HumanResumeExecutionRequest, HumanResumeExecutor } from "./index.js";
import {
  HumanResolutionCoordinator,
  HumanResumeOrchestrator,
  InMemoryCheckpointRepository,
  InMemoryHumanResolutionClaimStore,
  InMemoryRunRepository,
  type OwnershipScope,
} from "./index.js";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";

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

const executionResult = (): ExecutionResult => ({
  run: { ...waitingRun(), status: "SUCCEEDED", finishedAt: "2026-08-19T00:00:05.000Z" },
  checkpoint: checkpoint(),
});

class RecordingExecutor implements HumanResumeExecutor {
  readonly calls: HumanResumeExecutionRequest[] = [];

  constructor(private readonly failure?: Error) {}

  async execute(request: HumanResumeExecutionRequest): Promise<ExecutionResult> {
    this.calls.push(structuredClone(request));
    if (this.failure) throw this.failure;
    return executionResult();
  }
}

async function setup(executor = new RecordingExecutor()) {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  await runs.createIfAbsent(waitingRun());
  await checkpoints.put(scope, checkpoint());
  const resolutions = new HumanResolutionCoordinator({
    runs,
    checkpoints,
    claims: new InMemoryHumanResolutionClaimStore(),
    now: () => new Date("2026-08-19T00:00:03.000Z"),
  });
  return {
    executor,
    orchestrator: new HumanResumeOrchestrator({ resolutions, executor }),
  };
}

const command = (resolutionId = "resolution-1") => ({
  scope,
  runId: "run-1",
  expectedNodeId: "human-1",
  resolutionId,
});

describe("HumanResumeOrchestrator", () => {
  it("starts resume execution only after a newly accepted durable claim", async () => {
    const { orchestrator, executor } = await setup();

    const result = await orchestrator.execute(command());

    expect(result.kind).toBe("EXECUTED");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.validated.result.status).toBe("ACCEPTED");
    expect(executor.calls[0]?.validated.checkpoint.variables).toEqual({ reportId: "R-42" });
  });

  it("treats identical at-least-once delivery as non-executing replay", async () => {
    const { orchestrator, executor } = await setup();

    const first = await orchestrator.execute(command());
    const replay = await orchestrator.execute(command());

    expect(first.kind).toBe("EXECUTED");
    expect(replay).toMatchObject({ kind: "NOT_EXECUTED", claim: { status: "REPLAY" } });
    expect(executor.calls).toHaveLength(1);
  });

  it("does not execute a competing resolution after one resolution already won", async () => {
    const { orchestrator, executor } = await setup();

    await orchestrator.execute(command("resolution-a"));
    const conflict = await orchestrator.execute(command("resolution-b"));

    expect(conflict).toMatchObject({ kind: "NOT_EXECUTED", claim: { status: "CONFLICT" } });
    expect(executor.calls).toHaveLength(1);
  });

  it("serializes concurrent duplicate delivery before resume execution", async () => {
    const { orchestrator, executor } = await setup();

    const results = await Promise.all([
      orchestrator.execute(command()),
      orchestrator.execute(command()),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["EXECUTED", "NOT_EXECUTED"]);
    expect(executor.calls).toHaveLength(1);
  });

  it("fails closed after an accepted worker failure instead of replaying browser side effects", async () => {
    const executor = new RecordingExecutor(new Error("worker crashed"));
    const { orchestrator } = await setup(executor);

    await expect(orchestrator.execute(command())).rejects.toThrow("worker crashed");
    const replay = await orchestrator.execute(command());

    expect(replay).toMatchObject({ kind: "NOT_EXECUTED", claim: { status: "REPLAY" } });
    expect(executor.calls).toHaveLength(1);
  });
});
