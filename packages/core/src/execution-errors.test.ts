import { describe, expect, it } from "vitest";
import type { RunRecord, WorkflowGraph, WorkflowNode } from "@automation/contracts";
import {
  ClassifiedExecutionError,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  WorkflowExecutionEngine,
  type BrowserActionResult,
  type BrowserExecutor,
  type OwnershipScope,
  type ReasoningDecision,
  type ReasoningProvider,
  type VerificationEngine,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function run(): RunRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId: "run-errors",
    automationId: "auto-errors",
    workflowVersion: 1,
    occurrenceKey: "auto-errors:2026-08-18T12:00:00.000Z",
    status: "RUNNING",
    scheduledAt: "2026-08-18T12:00:00.000Z",
    startedAt: "2026-08-18T12:00:00.000Z",
  };
}

function endNode(): WorkflowNode {
  return {
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
  };
}

function graph(entry: WorkflowNode): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "wf-errors",
    automationId: "auto-errors",
    version: 1,
    entryNodeId: entry.id,
    objective: "Exercise durable error handling",
    nodes: { [entry.id]: entry, end: endNode() },
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

async function execute(
  entry: WorkflowNode,
  browser: BrowserExecutor,
  reasoner: ReasoningProvider,
  verifier: VerificationEngine,
) {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const initial = run();
  await runs.createIfAbsent(initial);
  const engine = new WorkflowExecutionEngine({
    browser,
    reasoner,
    verifier,
    runs,
    checkpoints,
    now: () => new Date("2026-08-18T12:00:01.000Z"),
    jitter: () => 0.5,
    sleep: async () => undefined,
    repeatedFingerprintLimit: 3,
  });
  return engine.execute({ scope, run: initial, graph: graph(entry) });
}

const verified: VerificationEngine = {
  async verify() {
    return { verified: true, evidenceRefs: ["evidence://verify"], detail: "ok" };
  },
};

const unusedReasoner: ReasoningProvider = {
  async decide() {
    throw new Error("reasoner should not be called");
  },
};

describe("durable execution error boundary", () => {
  it("sanitizes an unknown browser exception into a durable UNKNOWN failure", async () => {
    const entry: WorkflowNode = {
      id: "navigate",
      kind: "NAVIGATE",
      objective: "Open the site",
      deterministicStrategies: [{ kind: "URL", value: "https://example.com" }],
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
      timeoutMs: 5_000,
      next: ["end"],
      escalation: "FAIL",
    };
    const browser: BrowserExecutor = {
      async executeDeterministic() {
        throw new Error("secret provider response that must not be persisted");
      },
      async executeSemantic() {
        throw new Error("unused");
      },
    };

    const result = await execute(entry, browser, unusedReasoner, verified);
    expect(result.run.status).toBe("FAILED");
    expect(result.run.failure?.code).toBe("UNKNOWN");
    expect(result.run.failure?.message).toBe("deterministic browser execution failed");
    expect(JSON.stringify(result)).not.toContain("secret provider response");
    expect(result.checkpoint?.lastFailure?.code).toBe("UNKNOWN");
  });

  it("retries a classified provider rate limit and completes after recovery", async () => {
    const entry: WorkflowNode = {
      id: "reason",
      kind: "REASON",
      objective: "Choose the permitted click",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: ["CLICK"],
      verification: {
        description: "click effect is visible",
        mode: "DOM",
        timeoutMs: 2_000,
      },
      retryPolicy: {
        maxAttempts: 2,
        initialBackoffMs: 10,
        maxBackoffMs: 10,
        jitter: false,
        retryableFailureCodes: ["PROVIDER_RATE_LIMIT"],
      },
      timeoutMs: 5_000,
      next: ["end"],
      escalation: "FAIL",
    };
    let calls = 0;
    const reasoner: ReasoningProvider = {
      async decide(): Promise<ReasoningDecision> {
        calls += 1;
        if (calls === 1) {
          throw new ClassifiedExecutionError({
            code: "PROVIDER_RATE_LIMIT",
            message: "reasoning provider temporarily rate limited",
            retryable: true,
            evidenceRefs: [],
          });
        }
        return { summary: "click target", action: "CLICK", arguments: {}, confidence: 0.9 };
      },
    };
    const browser: BrowserExecutor = {
      async executeDeterministic() {
        throw new Error("unused");
      },
      async executeSemantic(): Promise<BrowserActionResult> {
        return { effectObserved: true, evidenceRefs: ["evidence://click"], outputs: {} };
      },
    };

    const result = await execute(entry, browser, reasoner, verified);
    expect(result.run.status).toBe("SUCCEEDED");
    expect(calls).toBe(2);
  });

  it("pauses for human intervention on a classified provider authentication failure", async () => {
    const entry: WorkflowNode = {
      id: "reason",
      kind: "REASON",
      objective: "Choose a permitted click",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: ["CLICK"],
      verification: {
        description: "click effect is visible",
        mode: "DOM",
        timeoutMs: 2_000,
      },
      retryPolicy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        jitter: false,
        retryableFailureCodes: [],
      },
      timeoutMs: 5_000,
      next: ["end"],
      escalation: "FAIL",
    };
    const reasoner: ReasoningProvider = {
      async decide() {
        throw new ClassifiedExecutionError({
          code: "PROVIDER_AUTH_INVALID",
          message: "reasoning provider credential is invalid",
          retryable: false,
          evidenceRefs: [],
        });
      },
    };
    const browser: BrowserExecutor = {
      async executeDeterministic() {
        throw new Error("unused");
      },
      async executeSemantic() {
        throw new Error("unused");
      },
    };

    const result = await execute(entry, browser, reasoner, verified);
    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    expect(result.checkpoint?.lastFailure?.code).toBe("PROVIDER_AUTH_INVALID");
  });

  it("persists a sanitized verifier exception instead of crashing the worker", async () => {
    const entry: WorkflowNode = {
      id: "click",
      kind: "CLICK",
      objective: "Click and verify",
      deterministicStrategies: [{ kind: "ROLE", value: "button:Submit" }],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: ["submit"],
      verification: {
        description: "submission is confirmed",
        mode: "TEXT",
        expected: "Done",
        timeoutMs: 2_000,
      },
      retryPolicy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        jitter: false,
        retryableFailureCodes: [],
      },
      timeoutMs: 5_000,
      next: ["end"],
      escalation: "FAIL",
    };
    const browser: BrowserExecutor = {
      async executeDeterministic() {
        return { effectObserved: true, evidenceRefs: ["evidence://action"], outputs: {} };
      },
      async executeSemantic() {
        throw new Error("unused");
      },
    };
    const verifier: VerificationEngine = {
      async verify() {
        throw new Error("private DOM fragment");
      },
    };

    const result = await execute(entry, browser, unusedReasoner, verifier);
    expect(result.run.status).toBe("FAILED");
    expect(result.run.failure?.message).toBe("effect verification failed");
    expect(JSON.stringify(result)).not.toContain("private DOM fragment");
  });
});
