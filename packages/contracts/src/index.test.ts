import { describe, expect, it } from "vitest";
import {
  assertWorkflowGraph,
  makeOccurrenceKey,
  type WorkflowGraph,
} from "./index.js";

const baseGraph = (): WorkflowGraph => ({
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "start",
  objective: "Open dashboard and verify it loaded",
  createdAt: new Date(0).toISOString(),
  nodes: {
    start: {
      id: "start",
      kind: "NAVIGATE",
      objective: "Open the dashboard",
      deterministicStrategies: [{ kind: "URL", value: "https://example.com" }],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: {
        maxAttempts: 2,
        initialBackoffMs: 250,
        maxBackoffMs: 2_000,
        jitter: true,
        retryableFailureCodes: ["TRANSIENT_NETWORK"],
      },
      timeoutMs: 30_000,
      next: ["done"],
      escalation: "SEMANTIC_RECOVERY",
    },
    done: {
      id: "done",
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
});

describe("workflow contracts", () => {
  it("accepts a valid graph", () => {
    expect(() => assertWorkflowGraph(baseGraph())).not.toThrow();
  });

  it("rejects missing graph references", () => {
    const graph = baseGraph();
    const start = graph.nodes.start;
    if (!start) throw new Error("test fixture missing start node");
    start.next = ["missing"];
    expect(() => assertWorkflowGraph(graph)).toThrow(/missing node/);
  });

  it("rejects invalid retry budgets", () => {
    const graph = baseGraph();
    const start = graph.nodes.start;
    if (!start) throw new Error("test fixture missing start node");
    start.retryPolicy.maxAttempts = 0;
    expect(() => assertWorkflowGraph(graph)).toThrow(/at least one attempt/);
  });
});

describe("occurrence idempotency", () => {
  it("canonicalizes equivalent timestamps", () => {
    expect(makeOccurrenceKey("auto-1", "2026-08-18T22:00:00+05:30")).toBe(
      "auto-1:2026-08-18T16:30:00.000Z",
    );
  });

  it("rejects invalid timestamps", () => {
    expect(() => makeOccurrenceKey("auto-1", "tomorrow-ish")).toThrow(/ISO-8601/);
  });
});
