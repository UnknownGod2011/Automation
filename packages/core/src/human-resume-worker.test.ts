import { describe, expect, it } from "vitest";
import type {
  AutomationRecord,
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
} from "@automation/contracts";
import {
  HumanResumeWorker,
  InMemoryAutomationRepository,
  InMemoryCheckpointRepository,
  InMemoryHumanResumeExecutionLeaseStore,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  type BrowserExecutionRuntime,
  type BrowserExecutionRuntimeFactory,
  type BrowserSessionHandle,
  type BrowserSessionManager,
  type HumanResumeExecutionRequest,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const automation = (overrides: Partial<AutomationRecord> = {}): AutomationRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Resume test",
  websiteUrl: "https://example.com",
  prompt: "complete the workflow",
  status: "ACTIVE",
  publishedWorkflowVersion: 4,
  browserProfileRef: "profile://tenant-1/auto-1",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  ...overrides,
});

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
  completedNodeIds: ["before-human"],
  attempt: 0,
  fingerprintRepeatCount: 0,
  variables: { reportId: "R-42" },
  evidenceRefs: ["evidence://before-human"],
  updatedAt: "2026-08-19T00:00:02.000Z",
});

const node = (
  id: string,
  kind: "HUMAN" | "END",
  next: readonly string[] = [],
) => ({
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
  escalation: "HUMAN" as const,
});

const graph = (pauseAgain = false): WorkflowGraph => ({
  schemaVersion: 1,
  workflowId: "workflow-1",
  automationId: "auto-1",
  version: 3,
  entryNodeId: "human-1",
  objective: "resume safely",
  nodes: pauseAgain
    ? {
        "human-1": node("human-1", "HUMAN", ["human-2"]),
        "human-2": node("human-2", "HUMAN", ["end"]),
        end: node("end", "END"),
      }
    : {
        "human-1": node("human-1", "HUMAN", ["end"]),
        end: node("end", "END"),
      },
  createdAt: "2026-08-18T00:00:00.000Z",
  publishedAt: "2026-08-18T00:01:00.000Z",
});

class RecordingSessions implements BrowserSessionManager {
  readonly started: string[] = [];
  readonly saved: string[] = [];
  readonly stopped: string[] = [];

  constructor(private readonly failSave = false) {}

  async start(
    _scope: OwnershipScope,
    request: { automationId: string; runId: string; profileRef?: string; timeoutSeconds: number },
  ): Promise<BrowserSessionHandle> {
    this.started.push(`${request.runId}:${request.profileRef ?? "none"}`);
    return {
      sessionId: "session-1",
      connection: { endpoint: "wss://browser.invalid", headers: {} },
    };
  }

  async saveProfile(
    _scope: OwnershipScope,
    session: BrowserSessionHandle,
    profileRef: string,
  ): Promise<void> {
    if (this.failSave) throw new Error("profile save failed");
    this.saved.push(`${session.sessionId}:${profileRef}`);
  }

  async stop(_scope: OwnershipScope, session: BrowserSessionHandle): Promise<void> {
    this.stopped.push(session.sessionId);
  }
}

class RecordingRuntimeFactory implements BrowserExecutionRuntimeFactory {
  createCalls = 0;
  closeCalls = 0;

  async create(): Promise<BrowserExecutionRuntime> {
    this.createCalls += 1;
    return {
      browser: {
        executeDeterministic: async () => {
          throw new Error("browser action should not run in HUMAN -> END fixture");
        },
        executeSemantic: async () => {
          throw new Error("semantic browser action should not run in HUMAN -> END fixture");
        },
      },
      verifier: {
        verify: async () => {
          throw new Error("verification should not run in HUMAN -> END fixture");
        },
      },
      close: async () => {
        this.closeCalls += 1;
      },
    };
  }
}

async function setup(options: {
  automation?: AutomationRecord;
  pauseAgain?: boolean;
  now?: string;
  failSave?: boolean;
} = {}) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const leases = new InMemoryHumanResumeExecutionLeaseStore();
  const sessions = new RecordingSessions(options.failSave);
  const runtimeFactory = new RecordingRuntimeFactory();

  await automations.put(options.automation ?? automation());
  await workflows.putImmutable(scope, graph(options.pauseAgain));
  await runs.createIfAbsent(waitingRun());
  await checkpoints.put(scope, checkpoint());

  const command = {
    scope,
    runId: "run-1",
    expectedNodeId: "human-1",
    resolutionId: "resolution-1",
  };
  const acquired = await leases.acquire(
    command,
    "worker-1",
    "2026-08-19T00:00:03.000Z",
    60_000,
  );
  if (acquired.status !== "ACQUIRED") throw new Error("fixture lease was not acquired");

  const request: HumanResumeExecutionRequest = {
    command,
    validated: {
      result: {
        status: "ACCEPTED",
        claim: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          runId: command.runId,
          nodeId: command.expectedNodeId,
          resolutionId: command.resolutionId,
          acceptedAt: "2026-08-19T00:00:02.500Z",
        },
      },
      run: waitingRun(),
      checkpoint: checkpoint(),
    },
    lease: acquired.lease,
  };

  const worker = new HumanResumeWorker({
    automations,
    workflows,
    sessions,
    runtimeFactory,
    reasoner: {
      decide: async () => {
        throw new Error("reasoner should not run in HUMAN -> END fixture");
      },
    },
    runs,
    checkpoints,
    leases,
    browserSessionTimeoutSeconds: 60,
    leaseTtlMs: 60_000,
    now: () => new Date(options.now ?? "2026-08-19T00:00:04.000Z"),
  });

  return { worker, request, runs, checkpoints, leases, sessions, runtimeFactory };
}

describe("HumanResumeWorker", () => {
  it("reconstructs the immutable run workflow/profile and completes explicit HUMAN resume", async () => {
    const { worker, request, runs, sessions, runtimeFactory } = await setup();

    const result = await worker.execute(request);

    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.run.workflowVersion).toBe(3);
    expect(result.checkpoint?.completedNodeIds).toContain("human-1");
    expect(result.checkpoint?.variables).toEqual({ reportId: "R-42" });
    expect((await runs.get(scope, "run-1"))?.status).toBe("SUCCEEDED");
    expect(sessions.started).toEqual(["run-1:profile://tenant-1/auto-1"]);
    expect(sessions.saved).toHaveLength(1);
    expect(sessions.stopped).toEqual(["session-1"]);
    expect(runtimeFactory.createCalls).toBe(1);
    expect(runtimeFactory.closeCalls).toBe(1);
  });

  it("loads the run's immutable workflow version even when a newer version is published", async () => {
    const { worker, request } = await setup({ automation: automation({ publishedWorkflowVersion: 99 }) });

    const result = await worker.execute(request);

    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.run.workflowVersion).toBe(3);
  });

  it("refuses to open browser compute when the automation was disabled after pausing", async () => {
    const { worker, request, sessions, runtimeFactory } = await setup({
      automation: automation({ status: "DISABLED" }),
    });

    await expect(worker.execute(request)).rejects.toThrow("is not active for human resume");
    expect(sessions.started).toHaveLength(0);
    expect(runtimeFactory.createCalls).toBe(0);
  });

  it("renews execution ownership before opening browser compute and fails closed if expired", async () => {
    const { worker, request, sessions, runtimeFactory } = await setup({
      now: "2026-08-19T00:02:00.000Z",
    });

    await expect(worker.execute(request)).rejects.toThrow("heartbeat lost ownership");
    expect(sessions.started).toHaveLength(0);
    expect(runtimeFactory.createCalls).toBe(0);
  });

  it("persists the browser profile again when resumed execution reaches another HUMAN pause", async () => {
    const { worker, request, sessions } = await setup({ pauseAgain: true });

    const result = await worker.execute(request);

    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    expect(result.run.currentNodeId).toBe("human-2");
    expect(sessions.saved).toHaveLength(1);
    expect(sessions.stopped).toEqual(["session-1"]);
  });

  it("does not report durable success when browser-profile persistence fails", async () => {
    const { worker, request, runs } = await setup({ failSave: true });

    await expect(worker.execute(request)).rejects.toThrow("profile save failed");
    expect((await runs.get(scope, "run-1"))?.status).not.toBe("SUCCEEDED");
  });

  it("rejects a lease from another human-resolution boundary before loading runtime", async () => {
    const { worker, request, sessions } = await setup();
    const forged = {
      ...request,
      lease: { ...request.lease, nodeId: "other-human" },
    };

    await expect(worker.execute(forged)).rejects.toThrow("lease does not match");
    expect(sessions.started).toHaveLength(0);
  });
});
