import { describe, expect, it } from "vitest";
import type {
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import {
  WorkflowExecutionEngine,
  type BrowserActionResult,
  type BrowserExecutor,
  type CheckpointRepository,
  type OwnershipScope,
  type ReasoningDecision,
  type ReasoningProvider,
  type ReasoningRequest,
  type RunRepository,
  type VerificationEngine,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const clickNode: WorkflowNode = {
  id: "click",
  kind: "CLICK",
  objective: "Open the newest invoice",
  deterministicStrategies: [{ kind: "ROLE", value: "button:Open" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["CLICK"],
  verification: {
    description: "invoice detail is visible",
    mode: "URL",
    expected: "/invoice/",
    timeoutMs: 2_000,
  },
  retryPolicy: {
    maxAttempts: 2,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
    jitter: false,
    retryableFailureCodes: ["ELEMENT_NOT_FOUND"],
  },
  timeoutMs: 5_000,
  next: ["end"],
  escalation: "SEMANTIC_RECOVERY",
};

const graph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "click",
  objective: "Review the newest pending invoice and open its detail page",
  createdAt: "2026-08-22T00:00:00.000Z",
  nodes: {
    click: clickNode,
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

const initialRun: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: graph.automationId,
  workflowVersion: graph.version,
  occurrenceKey: "occurrence-1",
  status: "RUNNING",
  scheduledAt: "2026-08-22T12:00:00.000Z",
  startedAt: "2026-08-22T12:00:00.000Z",
};

class MemoryRuns implements RunRepository {
  value = structuredClone(initialRun);

  async createIfAbsent(run: RunRecord) {
    return { created: false as const, run: structuredClone(run) };
  }

  async get(_: OwnershipScope, runId: string) {
    return runId === this.value.runId ? structuredClone(this.value) : null;
  }

  async update(run: RunRecord) {
    this.value = structuredClone(run);
  }

  async listForAutomation(_: OwnershipScope, automationId: string) {
    return automationId === this.value.automationId ? [structuredClone(this.value)] : [];
  }
}

class MemoryCheckpoints implements CheckpointRepository {
  value: RunCheckpoint | null = null;

  async get(_: OwnershipScope, runId: string) {
    return this.value?.runId === runId ? structuredClone(this.value) : null;
  }

  async put(_: OwnershipScope, checkpoint: RunCheckpoint) {
    this.value = structuredClone(checkpoint);
  }
}

class RecoveringBrowser implements BrowserExecutor {
  async executeDeterministic(): Promise<BrowserActionResult> {
    return {
      effectObserved: false,
      evidenceRefs: [],
      outputs: {},
      stateFingerprint: "invoice-list-v2",
      failure: {
        code: "ELEMENT_NOT_FOUND",
        message: "captured target moved",
        retryable: true,
        nodeId: clickNode.id,
        evidenceRefs: [],
      },
    };
  }

  async executeSemantic(
    _: OwnershipScope,
    __: string,
    ___: WorkflowNode,
    ____: ReasoningDecision,
  ): Promise<BrowserActionResult> {
    return { effectObserved: true, evidenceRefs: [], outputs: {} };
  }
}

class CapturingReasoner implements ReasoningProvider {
  requests: ReasoningRequest[] = [];

  async decide(request: ReasoningRequest): Promise<ReasoningDecision> {
    this.requests.push(structuredClone(request));
    return {
      summary: "Use the moved invoice button",
      action: "CLICK",
      arguments: {},
      confidence: 0.9,
    };
  }
}

const verifier: VerificationEngine = {
  async verify() {
    return { verified: true, evidenceRefs: [], detail: "invoice URL matched" };
  },
};

describe("semantic reasoning objective", () => {
  it("binds semantic recovery to the immutable workflow goal and current step", async () => {
    const runs = new MemoryRuns();
    const checkpoints = new MemoryCheckpoints();
    const reasoner = new CapturingReasoner();
    const engine = new WorkflowExecutionEngine({
      browser: new RecoveringBrowser(),
      reasoner,
      verifier,
      runs,
      checkpoints,
      now: () => new Date("2026-08-22T12:00:01.000Z"),
      sleep: async () => undefined,
      jitter: () => 0.5,
    });

    const result = await engine.execute({ scope, run: initialRun, graph });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(reasoner.requests).toHaveLength(1);
    expect(reasoner.requests[0]?.objective).toBe(
      "Workflow goal: Review the newest pending invoice and open its detail page\n" +
      "Current step: Open the newest invoice",
    );
    expect(reasoner.requests[0]?.allowedActions).toEqual(["CLICK"]);
    expect(reasoner.requests[0]?.objective).not.toContain(scope.tenantId);
    expect(reasoner.requests[0]?.objective).not.toContain(scope.userId);
  });
});
