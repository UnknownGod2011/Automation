import { describe, expect, it, vi } from "vitest";
import type {
  AutomationRecord,
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import {
  HumanResumeRecoveryWorker,
  InMemoryAutomationRepository,
  InMemoryHumanResumeEffectReconciliationStore,
  InMemoryHumanResumeExecutionLeaseStore,
  InMemoryWorkflowVersionRepository,
  type BrowserSessionHandle,
  type BrowserSessionManager,
  type HumanResumeRecoveryExecutionRequest,
  type HumanResumeReconciliationRuntime,
  type HumanResumeReconciliationRuntimeFactory,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const command = {
  scope,
  runId: "run-1",
  expectedNodeId: "human-1",
  resolutionId: "resolution-1",
};
const run: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 3,
  occurrenceKey: "occurrence-1",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-19T00:00:00.000Z",
  currentNodeId: "human-1",
};
const checkpoint: RunCheckpoint = {
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 3,
  currentNodeId: "human-1",
  completedNodeIds: ["before-human"],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: { reportId: "R-42" },
  evidenceRefs: ["evidence://before-human"],
  updatedAt: "2026-08-19T00:00:00.000Z",
};
const automation = (status: AutomationRecord["status"] = "ACTIVE"): AutomationRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Recovery test",
  websiteUrl: "https://example.com",
  prompt: "recover safely",
  status,
  publishedWorkflowVersion: 3,
  browserProfileRef: "profile://tenant-1/auto-1",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
});

function node(id: string, kind: "HUMAN" | "END", next: readonly string[] = []): WorkflowNode {
  return {
    id,
    kind,
    objective: id,
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
    next,
    escalation: "HUMAN",
  };
}

function clickNode(): WorkflowNode {
  return {
    id: "click-1",
    kind: "CLICK",
    objective: "submit once",
    deterministicStrategies: [{ kind: "TEXT", value: "Submit" }],
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: ["submit-form"],
    verification: {
      description: "saved marker",
      mode: "TEXT",
      expected: "Saved",
      timeoutMs: 1_000,
    },
    retryPolicy: {
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
      jitter: false,
      retryableFailureCodes: [],
    },
    timeoutMs: 1_000,
    next: ["end"],
    escalation: "HUMAN",
  };
}

function graph(successor = "click-1"): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "workflow-1",
    automationId: "auto-1",
    version: 3,
    entryNodeId: "human-1",
    objective: "recover safely",
    nodes: {
      "human-1": node("human-1", "HUMAN", [successor]),
      "click-1": clickNode(),
      other: { ...clickNode(), id: "other" },
      end: node("end", "END"),
    },
    createdAt: "2026-08-18T00:00:00.000Z",
    publishedAt: "2026-08-18T00:01:00.000Z",
  };
}

class RecordingSessions implements BrowserSessionManager {
  starts = 0;
  stops = 0;
  saves = 0;

  async start(_scope: OwnershipScope, request: { profileRef?: string }): Promise<BrowserSessionHandle> {
    this.starts += 1;
    expect(request.profileRef).toBe("profile://tenant-1/auto-1");
    return {
      sessionId: "session-1",
      connection: { endpoint: "wss://browser.invalid", headers: {} },
    };
  }

  async saveProfile(): Promise<void> {
    this.saves += 1;
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }
}

class RecordingRuntimeFactory implements HumanResumeReconciliationRuntimeFactory {
  creates = 0;
  closes = 0;
  inspections = 0;

  constructor(private readonly decision: "ALREADY_APPLIED" | "AMBIGUOUS") {}

  async create(): Promise<HumanResumeReconciliationRuntime> {
    this.creates += 1;
    return {
      verifier: {
        inspect: async () => {
          this.inspections += 1;
          return { decision: this.decision, evidenceRefs: ["evidence://reconciliation"] };
        },
      },
      close: async () => {
        this.closes += 1;
      },
    };
  }
}

async function setup(options: { status?: AutomationRecord["status"]; decision?: "ALREADY_APPLIED" | "AMBIGUOUS" } = {}) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const effects = new InMemoryHumanResumeEffectReconciliationStore();
  const leases = new InMemoryHumanResumeExecutionLeaseStore();
  const sessions = new RecordingSessions();
  const runtimeFactory = new RecordingRuntimeFactory(options.decision ?? "ALREADY_APPLIED");
  await automations.put(automation(options.status));
  await workflows.putImmutable(scope, graph());
  await effects.prepare(
    {
      tenantId: scope.tenantId,
      userId: scope.userId,
      runId: run.runId,
      humanNodeId: "human-1",
      successorNodeId: "click-1",
      resolutionId: "resolution-1",
      effectId: "effect-1",
    },
    "2026-08-19T00:00:00.000Z",
  );
  const acquired = await leases.acquire(command, "replacement-owner", "2026-08-19T00:00:00.000Z", 10_000);
  if (acquired.status !== "ACQUIRED") throw new Error("fixture lease was not acquired");
  const effect = await effects.get(scope, run.runId, "human-1");
  if (!effect) throw new Error("fixture effect missing");
  const claim = {
    status: "REPLAY" as const,
    claim: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      runId: run.runId,
      nodeId: "human-1",
      resolutionId: "resolution-1",
      acceptedAt: "2026-08-19T00:00:00.000Z",
    },
  };
  const request: HumanResumeRecoveryExecutionRequest = {
    kind: "RECONCILIATION_OWNERSHIP_ACQUIRED",
    claim,
    validated: { result: claim, run, checkpoint },
    effect,
    lease: acquired.lease,
  };
  const worker = new HumanResumeRecoveryWorker({
    automations,
    workflows,
    sessions,
    runtimeFactory,
    effects,
    leases,
    browserSessionTimeoutSeconds: 30,
    leaseTtlMs: 10_000,
    leaseHeartbeatIntervalMs: 3_000,
    now: () => new Date("2026-08-19T00:00:01.000Z"),
  });
  return { worker, request, automations, workflows, effects, leases, sessions, runtimeFactory };
}

describe("HumanResumeRecoveryWorker", () => {
  it("restores the profile in an observation-only runtime and persists ALREADY_APPLIED", async () => {
    const fixture = await setup();
    const result = await fixture.worker.execute(fixture.request);

    expect(result.reconciliation).toMatchObject({
      status: "DECIDED",
      record: { state: "DECIDED", decision: "ALREADY_APPLIED", effectId: "effect-1" },
    });
    expect(fixture.sessions.starts).toBe(1);
    expect(fixture.sessions.stops).toBe(1);
    expect(fixture.sessions.saves).toBe(0);
    expect(fixture.runtimeFactory.creates).toBe(1);
    expect(fixture.runtimeFactory.inspections).toBe(1);
    expect(fixture.runtimeFactory.closes).toBe(1);
  });

  it("returns AMBIGUOUS without mutating the paused run or executing an action path", async () => {
    const fixture = await setup({ decision: "AMBIGUOUS" });
    const result = await fixture.worker.execute(fixture.request);

    expect(result.reconciliation.record).toMatchObject({ decision: "AMBIGUOUS" });
    expect(fixture.request.validated.run.status).toBe("WAITING_FOR_HUMAN");
    expect(fixture.runtimeFactory.inspections).toBe(1);
    expect(fixture.sessions.saves).toBe(0);
  });

  it("treats an existing durable decision as authoritative without reinspection", async () => {
    const fixture = await setup();
    await fixture.effects.decide(
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        runId: run.runId,
        humanNodeId: "human-1",
        successorNodeId: "click-1",
        resolutionId: "resolution-1",
        effectId: "effect-1",
      },
      "ALREADY_APPLIED",
      "2026-08-19T00:00:00.500Z",
    );

    const result = await fixture.worker.execute(fixture.request);
    expect(result.reconciliation.status).toBe("REPLAY");
    expect(fixture.runtimeFactory.inspections).toBe(0);
  });

  it("rejects a disabled automation before browser startup", async () => {
    const fixture = await setup({ status: "DISABLED" });
    await expect(fixture.worker.execute(fixture.request)).rejects.toThrow("is not active");
    expect(fixture.sessions.starts).toBe(0);
    expect(fixture.runtimeFactory.creates).toBe(0);
  });

  it("rejects immutable successor drift before browser startup", async () => {
    const fixture = await setup();
    const drifted = graph("other");
    const workflows = new InMemoryWorkflowVersionRepository();
    await workflows.putImmutable(scope, drifted);
    const worker = new HumanResumeRecoveryWorker({
      automations: fixture.automations,
      workflows,
      sessions: fixture.sessions,
      runtimeFactory: fixture.runtimeFactory,
      effects: fixture.effects,
      leases: fixture.leases,
      browserSessionTimeoutSeconds: 30,
      leaseTtlMs: 10_000,
      leaseHeartbeatIntervalMs: 3_000,
      now: () => new Date("2026-08-19T00:00:01.000Z"),
    });

    await expect(worker.execute(fixture.request)).rejects.toThrow("effect successor does not match immutable workflow");
    expect(fixture.sessions.starts).toBe(0);
  });

  it("fails closed before browser startup when replacement ownership cannot be renewed", async () => {
    const fixture = await setup();
    const renew = vi.fn(async () => null);
    const worker = new HumanResumeRecoveryWorker({
      automations: fixture.automations,
      workflows: fixture.workflows,
      sessions: fixture.sessions,
      runtimeFactory: fixture.runtimeFactory,
      effects: fixture.effects,
      leases: {
        acquire: (...args) => fixture.leases.acquire(...args),
        renew,
        complete: (...args) => fixture.leases.complete(...args),
        get: (...args) => fixture.leases.get(...args),
      },
      browserSessionTimeoutSeconds: 30,
      leaseTtlMs: 10_000,
      leaseHeartbeatIntervalMs: 3_000,
      now: () => new Date("2026-08-19T00:00:01.000Z"),
    });

    await expect(worker.execute(fixture.request)).rejects.toThrow("heartbeat lost ownership");
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fixture.sessions.starts).toBe(0);
  });
});
