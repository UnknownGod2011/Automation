import { describe, expect, it } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryBrowserProfileStore,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  ScheduledRunCoordinator,
  type OwnershipScope,
  type RunPreflightCheck,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const now = () => new Date("2026-08-20T15:00:00.000Z");

function workflow(version: number): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: `wf-${version}`,
    automationId: "auto-1",
    version,
    entryNodeId: "end",
    objective: "Finish the fresh test",
    createdAt: `2026-08-20T1${version}:00:00.000Z`,
    initialVariables: { capturedLiteral: "from-capture", overridden: "capture" },
    nodes: {
      end: {
        id: "end",
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
  };
}

async function fixture(preflightChecks: readonly RunPreflightCheck[] = []) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const profiles = new InMemoryBrowserProfileStore();
  const profileRef = await profiles.create(scope, "auto-1");
  const automation: AutomationRecord = {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    name: "Fresh test",
    websiteUrl: "https://example.test/app",
    prompt: "Exercise the latest compiled workflow",
    status: "READY_TO_TEST",
    browserProfileRef: profileRef,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
  };
  await automations.put(automation);
  await workflows.putImmutable(scope, workflow(1));
  await workflows.putImmutable(scope, workflow(2));

  return {
    automations,
    runs,
    checkpoints,
    coordinator: new ScheduledRunCoordinator({
      automations,
      workflows,
      runs,
      checkpoints,
      profiles,
      locks: new InMemoryAutomationLockManager(now),
      preflightChecks,
      mode: "FRESH_TEST",
      now,
      lockTtlMs: 60_000,
    }),
  };
}

const request = {
  scope,
  automationId: "auto-1",
  scheduledAt: "2026-08-20T15:00:00.000Z",
  runId: "fresh-1",
  runtimeVariables: { runtimeValue: "provided-at-test", overridden: "runtime" },
};

describe("fresh-test run preparation", () => {
  it("pins the latest immutable workflow and seeds captured plus runtime variables before browser work", async () => {
    const { coordinator, checkpoints } = await fixture();
    const result = await coordinator.prepare(request);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") throw new Error("expected READY");
    expect(result.graph.version).toBe(2);
    expect(result.run.workflowVersion).toBe(2);
    expect(result.run.occurrenceKey).toBe("auto-1:test:fresh-1");
    await expect(checkpoints.get(scope, "fresh-1")).resolves.toEqual(
      expect.objectContaining({
        workflowVersion: 2,
        currentNodeId: "end",
        variables: {
          capturedLiteral: "from-capture",
          runtimeValue: "provided-at-test",
          overridden: "runtime",
        },
      }),
    );
  });

  it("deduplicates the same fresh-test run before any second execution lease can be created", async () => {
    const { coordinator } = await fixture();
    expect((await coordinator.prepare(request)).kind).toBe("READY");
    const replay = await coordinator.prepare({ ...request, scheduledAt: "2026-08-20T15:05:00.000Z" });
    expect(replay.kind).toBe("DUPLICATE");
    expect(replay.run.runId).toBe("fresh-1");
  });

  it("durably returns credential preflight blockers to human attention with test variables preserved", async () => {
    const blocker: RunPreflightCheck = {
      async check() {
        return {
          ready: false,
          disposition: "WAITING_FOR_HUMAN",
          failure: {
            code: "NOT_CONFIGURED",
            message: "reasoning credential is required",
            retryable: false,
            evidenceRefs: [],
          },
        };
      },
    };
    const { coordinator, checkpoints } = await fixture([blocker]);
    const result = await coordinator.prepare(request);
    expect(result.kind).toBe("BLOCKED");
    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    const checkpoint = await checkpoints.get(scope, "fresh-1");
    expect(checkpoint?.lastFailure?.code).toBe("NOT_CONFIGURED");
    expect(checkpoint?.variables.runtimeValue).toBe("provided-at-test");
  });

  it("rejects production fresh testing for an ACTIVE automation instead of silently using the published path", async () => {
    const { coordinator, automations } = await fixture();
    const current = await automations.get(scope, "auto-1");
    if (!current) throw new Error("missing fixture automation");
    await automations.put({ ...current, status: "ACTIVE", publishedWorkflowVersion: 1 });
    await expect(coordinator.prepare(request)).rejects.toThrow(
      "automation must be READY_TO_TEST or READY_TO_PUBLISH before a fresh test",
    );
  });
});
