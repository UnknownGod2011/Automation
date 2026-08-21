import { describe, expect, it } from "vitest";
import type { AutomationRecord, RunCheckpoint, RunRecord, WorkflowGraph, WorkflowNode } from "@automation/contracts";
import {
  HumanResumeWorker,
  InMemoryAutomationRepository,
  InMemoryCheckpointRepository,
  InMemoryHumanResumeEffectReconciliationStore,
  InMemoryHumanResumeExecutionLeaseStore,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  type BrowserExecutionRuntime,
  type BrowserSessionHandle,
  type BrowserSessionManager,
  type HumanResumeExecutionRequest,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const run: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-auth",
  automationId: "auto-1",
  workflowVersion: 1,
  occurrenceKey: "occurrence-auth",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-21T00:00:00.000Z",
  startedAt: "2026-08-21T00:00:01.000Z",
  currentNodeId: "navigate",
};

function pausedCheckpoint(code: "TARGET_AUTH_REQUIRED" | "POLICY_BLOCKED", nodeId = "navigate"): RunCheckpoint {
  return {
    runId: run.runId,
    automationId: run.automationId,
    workflowVersion: run.workflowVersion,
    currentNodeId: "navigate",
    completedNodeIds: [],
    attempt: 2,
    fingerprintRepeatCount: 2,
    variables: { ticket: "42" },
    evidenceRefs: ["evidence://before-auth"],
    lastFailure: { code, message: "sanitized fixture", retryable: false, nodeId, evidenceRefs: [] },
    updatedAt: "2026-08-21T00:00:02.000Z",
  };
}

const navigate: WorkflowNode = {
  id: "navigate",
  kind: "NAVIGATE",
  objective: "open authenticated dashboard",
  deterministicStrategies: [{ kind: "URL", value: "https://example.test/dashboard" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: [],
  retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
  timeoutMs: 1_000,
  next: ["end"],
  escalation: "HUMAN",
};
const end: WorkflowNode = { ...navigate, id: "end", kind: "END", deterministicStrategies: [], next: [] };
const graph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "workflow-1",
  automationId: run.automationId,
  version: run.workflowVersion,
  entryNodeId: "navigate",
  objective: "continue after user repairs target authentication",
  nodes: { navigate, end },
  createdAt: "2026-08-21T00:00:00.000Z",
  publishedAt: "2026-08-21T00:00:00.000Z",
};

class Sessions implements BrowserSessionManager {
  starts = 0;
  async start(): Promise<BrowserSessionHandle> {
    this.starts += 1;
    return { sessionId: "session-1", connection: { endpoint: "wss://browser.invalid", headers: {} } };
  }
  async saveProfile(): Promise<void> {}
  async stop(): Promise<void> {}
}

async function setup(lastFailure: RunCheckpoint["lastFailure"]) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const leases = new InMemoryHumanResumeExecutionLeaseStore();
  const sessions = new Sessions();
  const actions: string[] = [];
  const automation: AutomationRecord = {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: run.automationId,
    name: "Auth repair",
    websiteUrl: "https://example.test",
    prompt: "continue after login",
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    browserProfileRef: "profile://profile-1",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
  await automations.put(automation);
  await workflows.putImmutable(scope, graph);
  await runs.createIfAbsent(run);
  const cp = { ...pausedCheckpoint("TARGET_AUTH_REQUIRED"), ...(lastFailure ? { lastFailure } : {}) };
  await checkpoints.put(scope, cp);
  const command = { scope, runId: run.runId, expectedNodeId: "navigate", resolutionId: "repair-1" };
  const acquired = await leases.acquire(command, "worker-1", "2026-08-21T00:00:03.000Z", 60_000);
  if (acquired.status !== "ACQUIRED") throw new Error("lease fixture failed");
  const request: HumanResumeExecutionRequest = {
    command,
    validated: {
      result: { status: "ACCEPTED", claim: { tenantId: scope.tenantId, userId: scope.userId, runId: run.runId, nodeId: "navigate", resolutionId: "repair-1", acceptedAt: "2026-08-21T00:00:02.500Z" } },
      run,
      checkpoint: cp,
    },
    lease: acquired.lease,
  };
  const runtimeFactory = {
    create: async (): Promise<BrowserExecutionRuntime> => ({
      browser: {
        executeDeterministic: async (_scope, _runId, node) => {
          actions.push(node.id);
          return { effectObserved: true, evidenceRefs: [], outputs: {} };
        },
        executeSemantic: async () => { throw new Error("semantic fallback not expected"); },
      },
      verifier: { verify: async () => ({ verified: true, evidenceRefs: [], detail: "ok" }) },
      close: async () => undefined,
    }),
  };
  const worker = new HumanResumeWorker({
    automations, workflows, sessions, runtimeFactory,
    reasoner: { decide: async () => { throw new Error("reasoner not expected"); } },
    runs, checkpoints, leases,
    effects: new InMemoryHumanResumeEffectReconciliationStore(),
    effectId: () => "effect-1",
    browserSessionTimeoutSeconds: 60,
    leaseTtlMs: 60_000,
    now: () => new Date("2026-08-21T00:00:04.000Z"),
  });
  return { worker, request, sessions, actions };
}

describe("HumanResumeWorker target-auth repair", () => {
  it("re-executes the exact paused node after a proven TARGET_AUTH_REQUIRED repair", async () => {
    const { worker, request, actions } = await setup(pausedCheckpoint("TARGET_AUTH_REQUIRED").lastFailure);
    const result = await worker.execute(request);
    expect(result.run.status).toBe("SUCCEEDED");
    expect(actions).toEqual(["navigate"]);
    expect(result.checkpoint?.variables).toEqual({ ticket: "42" });
  });

  it("rejects generic human attention before browser allocation", async () => {
    const { worker, request, sessions } = await setup(pausedCheckpoint("POLICY_BLOCKED").lastFailure);
    await expect(worker.execute(request)).rejects.toThrow("not a target-authentication repair boundary");
    expect(sessions.starts).toBe(0);
  });

  it("rejects target-auth failure metadata for a different node", async () => {
    const { worker, request, sessions } = await setup(pausedCheckpoint("TARGET_AUTH_REQUIRED", "other").lastFailure);
    await expect(worker.execute(request)).rejects.toThrow("not a target-authentication repair boundary");
    expect(sessions.starts).toBe(0);
  });
});
