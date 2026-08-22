import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@automation/contracts";
import {
  requiredScheduledCaptureInputs,
  validateScheduledNonSecretInputs,
} from "./scheduled-runtime-inputs.js";

const graph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "type",
  objective: "Fill fields",
  initialVariables: { capture_input_2: "already-seeded" },
  createdAt: "2026-08-22T00:00:00.000Z",
  nodes: {
    type: {
      id: "type",
      kind: "TYPE",
      objective: "Type recipient",
      deterministicStrategies: [{ kind: "TEST_ID", value: "recipient" }],
      inputBindings: { value: "capture_input_7", ignored: "customer.email", seeded: "capture_input_2" },
      outputBindings: {},
      allowedSideEffects: [],
      verification: { description: "filled", mode: "CUSTOM", expected: "capture:input-filled", timeoutMs: 1_000 },
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
      timeoutMs: 1_000,
      next: ["end"],
      escalation: "FAIL",
    },
    end: {
      id: "end",
      kind: "END",
      objective: "Finish",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
      timeoutMs: 1_000,
      escalation: "FAIL",
    },
  },
};

describe("scheduled runtime inputs", () => {
  it("requires only unresolved capture-generated inputs", () => {
    expect(requiredScheduledCaptureInputs(graph)).toEqual(["capture_input_7"]);
    expect(validateScheduledNonSecretInputs(graph, { capture_input_7: "ops@example.test" })).toEqual({
      capture_input_7: "ops@example.test",
    });
  });

  it("fails closed on missing, extra, non-string, or oversized values", () => {
    expect(() => validateScheduledNonSecretInputs(graph, {})).toThrow("requires scheduled");
    expect(() => validateScheduledNonSecretInputs(graph, { capture_input_8: "x" })).toThrow("does not belong");
    expect(() => validateScheduledNonSecretInputs(graph, { capture_input_7: 7 })).toThrow("must be strings");
    expect(() => validateScheduledNonSecretInputs(graph, { capture_input_7: "x".repeat(4_097) })).toThrow("too long");
  });
});
