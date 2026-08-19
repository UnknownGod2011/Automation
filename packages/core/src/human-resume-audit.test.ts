import { describe, expect, it } from "vitest";
import type { ExecutionResult, HumanResumeAuditEvent, HumanResumeAuditStore, HumanResumeExecutionRequest, HumanResumeExecutor } from "./index.js";
import {
  assertHumanResumeAuditEvent,
  HumanResolutionCoordinator,
  HumanResumeOrchestrator,
  InMemoryCheckpointRepository,
  InMemoryHumanResolutionClaimStore,
  InMemoryHumanResumeExecutionLeaseStore,
  InMemoryRunRepository,
  type OwnershipScope,
} from "./index.js";
import type { RunCheckpoint, RunRecord } from "@automation/contracts";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const run = (): RunRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 1,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-19T01:00:00.000Z",
  currentNodeId: "human-1",
});
const checkpoint = (): RunCheckpoint => ({
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 1,
  currentNodeId: "human-1",
  completedNodeIds: [],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: {},
  evidenceRefs: [],
  updatedAt: "2026-08-19T01:00:00.000Z",
});
const command = { scope, runId: "run-1", expectedNodeId: "human-1", resolutionId: "resolution-1" };

class RecordingAudit implements HumanResumeAuditStore {
  readonly events: HumanResumeAuditEvent[] = [];
  constructor(private readonly fail = false) {}
  async append(event: HumanResumeAuditEvent): Promise<void> {
    if (this.fail) throw new Error("audit backend unavailable with secret=should-not-surface");
    this.events.push(structuredClone(event));
  }
  async listForRun(): Promise<readonly HumanResumeAuditEvent[]> {
    return this.events.map((event) => structuredClone(event));
  }
}

class SuccessfulExecutor implements HumanResumeExecutor {
  calls = 0;
  async execute(request: HumanResumeExecutionRequest): Promise<ExecutionResult> {
    this.calls += 1;
    return {
      run: { ...request.validated.run, status: "SUCCEEDED", finishedAt: "2026-08-19T01:00:01.000Z" },
      checkpoint: request.validated.checkpoint,
    };
  }
}

async function orchestrator(audit: HumanResumeAuditStore, warnings: string[] = []) {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  await runs.createIfAbsent(run());
  await checkpoints.put(scope, checkpoint());
  const resolutions = new HumanResolutionCoordinator({
    runs,
    checkpoints,
    claims: new InMemoryHumanResolutionClaimStore(),
    now: () => new Date("2026-08-19T01:00:00.000Z"),
  });
  const executor = new SuccessfulExecutor();
  let id = 0;
  return {
    executor,
    value: new HumanResumeOrchestrator({
      resolutions,
      leases: new InMemoryHumanResumeExecutionLeaseStore(),
      executor,
      ownerToken: () => "private-worker-token",
      now: () => new Date("2026-08-19T01:00:00.000Z"),
      leaseTtlMs: 60_000,
      audit,
      auditEventId: () => `audit-${++id}`,
      onAuditWarning: (warning) => warnings.push(warning),
    }),
  };
}

describe("human resume audit", () => {
  it("emits only the typed redacted lifecycle fields for a successful resume", async () => {
    const audit = new RecordingAudit();
    const { value } = await orchestrator(audit);

    await value.execute(command);

    expect(audit.events.map((event) => event.type)).toEqual([
      "RESOLUTION_ACCEPTED",
      "LEASE_ACQUIRED",
      "EXECUTION_STARTED",
      "EXECUTION_SUCCEEDED",
      "LEASE_COMPLETED",
    ]);
    expect(audit.events[0]).toEqual({
      eventId: "audit-1",
      occurredAt: "2026-08-19T01:00:00.000Z",
      type: "RESOLUTION_ACCEPTED",
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      nodeId: "human-1",
      resolutionId: "resolution-1",
    });
    expect(JSON.stringify(audit.events)).not.toContain("private-worker-token");
  });

  it("does not let an audit outage cause resume execution to fail or retry", async () => {
    const warnings: string[] = [];
    const { value, executor } = await orchestrator(new RecordingAudit(true), warnings);

    const result = await value.execute(command);

    expect(result.kind).toBe("EXECUTED");
    expect(executor.calls).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((warning) => warning === "human resume audit persistence failed")).toBe(true);
    expect(warnings.join(" ")).not.toContain("should-not-surface");
  });

  it("rejects malformed durable audit identity and timestamps", () => {
    expect(() =>
      assertHumanResumeAuditEvent({
        eventId: " ",
        occurredAt: "not-a-time",
        type: "EXECUTION_STARTED",
        tenantId: "tenant-1",
        userId: "user-1",
        runId: "run-1",
        nodeId: "human-1",
        resolutionId: "resolution-1",
      }),
    ).toThrow();
  });
});
