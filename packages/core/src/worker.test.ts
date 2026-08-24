import { describe, expect, it } from "vitest";
import type {
  AutomationRecord,
  WorkflowGraph,
} from "@automation/contracts";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  ScheduledRunCoordinator,
  ScheduledRunWorker,
  type BrowserActionResult,
  type BrowserExecutionRuntime,
  type BrowserExecutionRuntimeFactory,
  type BrowserProfileStore,
  type BrowserSessionHandle,
  type BrowserSessionManager,
  type OwnershipScope,
  type ReasoningProvider,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const endGraph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "end",
  objective: "Finish",
  createdAt: "2026-08-18T00:00:00.000Z",
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

const humanGraph: WorkflowGraph = {
  ...endGraph,
  workflowId: "wf-human",
  entryNodeId: "human",
  nodes: {
    human: {
      id: "human",
      kind: "HUMAN",
      objective: "Confirm the account",
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
      escalation: "HUMAN",
    },
  },
};

class PresentProfiles implements BrowserProfileStore {
  async create() { return "profile://auto-1"; }
  async exists() { return true; }
  async delete() {}
}

class FakeSessions implements BrowserSessionManager {
  readonly events: string[] = [];
  failSave = false;

  async start(): Promise<BrowserSessionHandle> {
    this.events.push("session:start");
    return {
      sessionId: "session-1",
      connection: {
        endpoint: "wss://example.invalid",
        headers: { authorization: "ephemeral" },
      },
    };
  }

  async saveProfile() {
    this.events.push("profile:save");
    if (this.failSave) throw new Error("raw provider save error");
  }

  async stop() {
    this.events.push("session:stop");
  }
}

class FakeRuntimeFactory implements BrowserExecutionRuntimeFactory {
  readonly events: string[];

  constructor(events: string[]) {
    this.events = events;
  }

  async create(): Promise<BrowserExecutionRuntime> {
    this.events.push("runtime:create");
    return {
      browser: {
        async executeDeterministic(): Promise<BrowserActionResult> {
          return { effectObserved: true, evidenceRefs: [], outputs: {} };
        },
        async executeSemantic(): Promise<BrowserActionResult> {
          return { effectObserved: true, evidenceRefs: [], outputs: {} };
        },
      },
      verifier: {
        async verify() {
          return { verified: true, evidenceRefs: [], detail: "verified" };
        },
      },
      close: async () => {
        this.events.push("runtime:close");
      },
    };
  }
}

const unusedReasoner: ReasoningProvider = {
  async decide() {
    throw new Error("reasoner should not be called");
  },
};

async function fixture(graph: WorkflowGraph = endGraph) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const locks = new InMemoryAutomationLockManager(
    () => new Date("2026-08-18T12:00:00.000Z"),
  );
  const profiles = new PresentProfiles();
  const sessions = new FakeSessions();
  const runtimeEvents = sessions.events;
  const runtimeFactory = new FakeRuntimeFactory(runtimeEvents);

  const automation: AutomationRecord = {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    name: "Daily report",
    websiteUrl: "https://example.com",
    prompt: "Open report",
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    browserProfileRef: "profile://auto-1",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
  await automations.put(automation);
  await workflows.putImmutable(scope, graph);

  const coordinator = new ScheduledRunCoordinator({
    automations,
    workflows,
    runs,
    checkpoints,
    profiles,
    locks,
    now: () => new Date("2026-08-18T12:00:00.000Z"),
    lockTtlMs: 60_000,
  });
  const worker = new ScheduledRunWorker({
    coordinator,
    sessions,
    runtimeFactory,
    reasoner: unusedReasoner,
    runs,
    checkpoints,
    browserSessionTimeoutSeconds: 3_600,
    now: () => new Date("2026-08-18T12:00:01.000Z"),
    sleep: async () => undefined,
    jitter: () => 0.5,
  });

  return { worker, runs, checkpoints, locks, sessions };
}

const request = {
  scope,
  automationId: "auto-1",
  scheduledAt: "2026-08-18T12:00:00.000Z",
  runId: "run-1",
};

describe("ScheduledRunWorker", () => {
  it("persists the browser profile before durable success and always tears down resources", async () => {
    const { worker, runs, locks, sessions } = await fixture();
    const result = await worker.execute(request);

    expect(result.kind).toBe("EXECUTED");
    if (result.kind !== "EXECUTED") throw new Error("expected execution");
    expect(result.execution.run.status).toBe("SUCCEEDED");
    expect((await runs.get(scope, "run-1"))?.status).toBe("SUCCEEDED");
    expect(sessions.events).toEqual([
      "session:start",
      "runtime:create",
      "profile:save",
      "runtime:close",
      "session:stop",
    ]);
    expect(result.cleanupWarnings).toEqual([]);

    expect(
      await locks.acquire(scope, "auto-1", "new-owner", 60_000),
    ).not.toBeNull();
  });

  it("does not expose SUCCEEDED if required profile persistence fails", async () => {
    const { worker, runs, checkpoints, sessions } = await fixture();
    sessions.failSave = true;

    const result = await worker.execute(request);
    expect(result.kind).toBe("EXECUTED");
    if (result.kind !== "EXECUTED") throw new Error("expected execution");
    expect(result.execution.run.status).toBe("FAILED");
    expect((await runs.get(scope, "run-1"))?.status).toBe("FAILED");
    expect(result.execution.run.failure?.message).toBe(
      "browser profile persistence failed",
    );
    expect(JSON.stringify(result.execution)).not.toContain("raw provider save error");
    expect((await checkpoints.get(scope, "run-1"))?.lastFailure?.message).toBe(
      "browser profile persistence failed",
    );
    expect(result.cleanupWarnings).toContain(
      "browser profile persistence failed during cleanup",
    );
    expect(sessions.events.at(-1)).toBe("session:stop");
  });

  it("saves profile state before tearing down a human-paused run", async () => {
    const { worker, sessions } = await fixture(humanGraph);
    const result = await worker.execute(request);

    expect(result.kind).toBe("EXECUTED");
    if (result.kind !== "EXECUTED") throw new Error("expected execution");
    expect(result.execution.run.status).toBe("WAITING_FOR_HUMAN");
    expect(sessions.events).toEqual([
      "session:start",
      "runtime:create",
      "profile:save",
      "runtime:close",
      "session:stop",
    ]);
  });

  it("deduplicates a repeated scheduled delivery without starting another browser", async () => {
    const { worker, sessions } = await fixture();
    expect((await worker.execute(request)).kind).toBe("EXECUTED");
    sessions.events.length = 0;

    const duplicate = await worker.execute({ ...request, runId: "run-2" });
    expect(duplicate.kind).toBe("NOT_RUN");
    if (duplicate.kind !== "NOT_RUN") throw new Error("expected duplicate");
    expect(duplicate.preparation.kind).toBe("DUPLICATE");
    expect(sessions.events).toEqual([]);
  });
});
