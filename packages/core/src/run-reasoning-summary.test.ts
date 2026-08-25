import { describe, expect, it } from "vitest";
import type { RunRecord, WorkflowGraph, WorkflowNode } from "@automation/contracts";
import {
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  RunDetailService,
  WorkflowExecutionEngine,
  type BrowserActionResult,
  type BrowserExecutor,
  type OwnershipScope,
  type ReasoningDecision,
  type ReasoningProvider,
  type VerificationEngine,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const semanticNode: WorkflowNode = {
  id: "private-click-node",
  kind: "CLICK",
  objective: "Open the approved invoice",
  deterministicStrategies: [{ kind: "ROLE", value: "button:Open" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["CLICK"],
  verification: {
    description: "invoice detail opened",
    mode: "URL",
    expected: "/invoice/",
    timeoutMs: 2_000,
  },
  retryPolicy: {
    maxAttempts: 1,
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
  workflowId: "private-workflow-id",
  automationId: "auto-1",
  version: 1,
  entryNodeId: semanticNode.id,
  objective: "Review the newest pending invoice",
  createdAt: "2026-08-25T07:00:00.000Z",
  nodes: {
    [semanticNode.id]: semanticNode,
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
  runId: "run-reasoning-1",
  automationId: graph.automationId,
  workflowVersion: graph.version,
  occurrenceKey: "auto-1:2026-08-25T07:01:00.000Z",
  status: "RUNNING",
  scheduledAt: "2026-08-25T07:01:00.000Z",
  startedAt: "2026-08-25T07:01:00.000Z",
};

class SemanticRecoveryBrowser implements BrowserExecutor {
  async executeDeterministic(): Promise<BrowserActionResult> {
    return {
      effectObserved: false,
      evidenceRefs: [],
      outputs: {},
      stateFingerprint: "private-state-fingerprint",
      failure: {
        code: "ELEMENT_NOT_FOUND",
        message: "captured target moved",
        retryable: true,
        nodeId: semanticNode.id,
        evidenceRefs: [],
      },
    };
  }

  async executeSemantic(): Promise<BrowserActionResult> {
    return { effectObserved: true, evidenceRefs: [], outputs: {} };
  }
}

class SensitiveSummaryReasoner implements ReasoningProvider {
  async decide(): Promise<ReasoningDecision> {
    return {
      summary: "private DOM text customer@example.com password=hunter2",
      action: "CLICK",
      arguments: { selector: "#private-selector" },
      confidence: 0.87,
    };
  }
}

const verifier: VerificationEngine = {
  async verify() {
    return { verified: true, evidenceRefs: [], detail: "invoice URL matched" };
  },
};

async function executeReasonedRun() {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  await runs.createIfAbsent(initialRun);
  await workflows.putImmutable(scope, graph);

  const engine = new WorkflowExecutionEngine({
    browser: new SemanticRecoveryBrowser(),
    reasoner: new SensitiveSummaryReasoner(),
    verifier,
    runs,
    checkpoints,
    now: () => new Date("2026-08-25T07:01:05.000Z"),
    sleep: async () => undefined,
    jitter: () => 0.5,
  });

  const result = await engine.execute({ scope, run: initialRun, graph });
  return { runs, checkpoints, workflows, result };
}

describe("durable reasoning summaries", () => {
  it("records an accepted semantic decision without persisting provider free-form rationale", async () => {
    const { runs, checkpoints, workflows, result } = await executeReasonedRun();
    expect(result.run.status).toBe("SUCCEEDED");

    const checkpoint = await checkpoints.get(scope, initialRun.runId);
    expect(checkpoint?.reasoningSummaries).toEqual([
      {
        nodeId: semanticNode.id,
        trigger: "SEMANTIC_RECOVERY",
        action: "CLICK",
        confidence: 0.87,
      },
    ]);
    const durableReasoning = JSON.stringify(checkpoint?.reasoningSummaries);
    expect(durableReasoning).not.toContain("customer@example.com");
    expect(durableReasoning).not.toContain("hunter2");
    expect(durableReasoning).not.toContain("#private-selector");

    const detail = await new RunDetailService(runs, checkpoints, workflows).get(
      scope,
      graph.automationId,
      initialRun.runId,
    );
    expect(detail.reasoning).toEqual([
      {
        step: 1,
        trigger: "SEMANTIC_RECOVERY",
        action: "CLICK",
        confidence: 0.87,
      },
    ]);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(semanticNode.id);
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("#private-selector");
  });

  it("fails closed when durable reasoning metadata is malformed", async () => {
    const { runs, checkpoints, workflows } = await executeReasonedRun();
    const checkpoint = await checkpoints.get(scope, initialRun.runId);
    if (!checkpoint) throw new Error("expected durable checkpoint");
    await checkpoints.put(scope, {
      ...checkpoint,
      reasoningSummaries: [
        {
          nodeId: semanticNode.id,
          trigger: "SEMANTIC_RECOVERY",
          action: "x".repeat(161),
          confidence: 0.87,
        },
      ],
    });

    await expect(
      new RunDetailService(runs, checkpoints, workflows).get(
        scope,
        graph.automationId,
        initialRun.runId,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
