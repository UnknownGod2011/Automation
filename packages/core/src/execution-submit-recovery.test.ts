import { describe, expect, it } from "vitest";
import type {
  CaptureTrace,
  RunCheckpoint,
  RunRecord,
  WorkflowNode,
} from "@automation/contracts";
import {
  WorkflowExecutionEngine,
  compileCaptureTrace,
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

const scope: OwnershipScope = { tenantId: "tenant-submit", userId: "user-submit" };

function submitTrace(): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-submit",
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-submit",
    websiteUrl: "https://app.example.com/form",
    objective: "Submit the demonstrated form once",
    browserProfileRef: "profile-submit",
    startedAt: "2026-08-26T04:00:00.000Z",
    finishedAt: "2026-08-26T04:01:00.000Z",
    events: [
      {
        eventId: "open-form",
        sequence: 1,
        kind: "NAVIGATION",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-26T04:00:10.000Z",
        page: { url: "https://app.example.com/form" },
        navigationUrl: "https://app.example.com/form",
        artifactRefs: [],
      },
      {
        eventId: "submit-form",
        sequence: 2,
        kind: "SUBMIT",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-26T04:00:20.000Z",
        page: { url: "https://app.example.com/form" },
        target: {
          role: "button",
          accessibleName: "Submit",
          testId: "submit-form",
        },
        expectedEffect: {
          description: "Submission confirmation appears",
          mode: "TEXT",
          expected: "Submitted",
          timeoutMs: 5_000,
        },
        artifactRefs: [],
      },
    ],
  };
}

const graph = compileCaptureTrace({
  trace: submitTrace(),
  workflowId: "workflow-submit",
  version: 1,
  createdAt: "2026-08-26T04:02:00.000Z",
});
const submitNode = graph.nodes["capture-2-submit-form"]!;

const initialRun: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-submit",
  automationId: graph.automationId,
  workflowVersion: graph.version,
  occurrenceKey: "occurrence-submit",
  status: "RUNNING",
  scheduledAt: "2026-08-26T04:03:00.000Z",
  startedAt: "2026-08-26T04:03:00.000Z",
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

class SubmitRecoveryBrowser implements BrowserExecutor {
  semanticCalls: { node: WorkflowNode; decision: ReasoningDecision }[] = [];

  async executeDeterministic(
    _: OwnershipScope,
    __: string,
    node: WorkflowNode,
  ): Promise<BrowserActionResult> {
    if (node.id !== submitNode.id) {
      return { effectObserved: true, evidenceRefs: [], outputs: {} };
    }
    return {
      effectObserved: false,
      evidenceRefs: [],
      outputs: {},
      stateFingerprint: "form-selector-drifted",
      semanticObservation: {
        schemaVersion: 1,
        page: {
          origin: "https://app.example.com",
          title: "Checkout — page text is untrusted",
        },
        interactive: [
          {
            role: "button",
            name: "Send now",
            testId: "replacement-submit",
          },
        ],
      },
      failure: {
        code: "ELEMENT_NOT_FOUND",
        message: "captured submit target moved",
        retryable: true,
        nodeId: node.id,
        evidenceRefs: [],
      },
    };
  }

  async executeSemantic(
    _: OwnershipScope,
    __: string,
    node: WorkflowNode,
    decision: ReasoningDecision,
  ): Promise<BrowserActionResult> {
    this.semanticCalls.push({ node: structuredClone(node), decision: structuredClone(decision) });
    return { effectObserved: true, evidenceRefs: [], outputs: {} };
  }
}

class FixedReasoner implements ReasoningProvider {
  requests: ReasoningRequest[] = [];

  constructor(private readonly action: string) {}

  async decide(request: ReasoningRequest): Promise<ReasoningDecision> {
    this.requests.push(structuredClone(request));
    return {
      summary: "Use the constrained replacement submit target",
      action: this.action,
      arguments: { testId: "replacement-submit" },
      confidence: 0.9,
    };
  }
}

const verifier: VerificationEngine = {
  async verify() {
    return { verified: true, evidenceRefs: [], detail: "submission effect verified" };
  },
};

function engine(browser: SubmitRecoveryBrowser, reasoner: ReasoningProvider) {
  return new WorkflowExecutionEngine({
    browser,
    reasoner,
    verifier,
    runs: new MemoryRuns(),
    checkpoints: new MemoryCheckpoints(),
    now: () => new Date("2026-08-26T04:03:01.000Z"),
    sleep: async () => undefined,
    jitter: () => 0.5,
  });
}

describe("captured SUBMIT semantic recovery", () => {
  it("preserves submit-only authority and supplies bounded live browser observations", async () => {
    expect(submitNode.kind).toBe("CLICK");
    expect(submitNode.allowedSideEffects).toEqual(["SUBMIT"]);

    const browser = new SubmitRecoveryBrowser();
    const reasoner = new FixedReasoner("SUBMIT");
    const result = await engine(browser, reasoner).execute({
      scope,
      run: structuredClone(initialRun),
      graph,
    });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(reasoner.requests).toHaveLength(1);
    expect(reasoner.requests[0]?.allowedActions).toEqual(["SUBMIT"]);
    expect(reasoner.requests[0]?.objective).not.toContain(scope.tenantId);
    expect(reasoner.requests[0]?.objective).not.toContain(scope.userId);
    expect(reasoner.requests[0]?.context).toEqual({
      browserObservation: {
        schemaVersion: 1,
        page: {
          origin: "https://app.example.com",
          title: "Checkout — page text is untrusted",
        },
        interactive: [
          { role: "button", name: "Send now", testId: "replacement-submit" },
        ],
      },
    });
    expect(JSON.stringify(reasoner.requests[0]?.context)).not.toContain("profile-submit");
    expect(browser.semanticCalls).toHaveLength(1);
    expect(browser.semanticCalls[0]?.decision).toMatchObject({
      action: "SUBMIT",
      arguments: { testId: "replacement-submit" },
    });
  });

  it("policy-blocks a generic CLICK decision for a submit-only captured node", async () => {
    const browser = new SubmitRecoveryBrowser();
    const reasoner = new FixedReasoner("CLICK");
    const result = await engine(browser, reasoner).execute({
      scope,
      run: structuredClone(initialRun),
      graph,
    });

    expect(reasoner.requests[0]?.allowedActions).toEqual(["SUBMIT"]);
    expect(browser.semanticCalls).toHaveLength(0);
    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    expect(result.checkpoint?.lastFailure).toMatchObject({
      code: "POLICY_BLOCKED",
      nodeId: submitNode.id,
      retryable: false,
    });
  });
});
