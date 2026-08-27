import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import { compileCaptureTrace } from "./workflow-compiler.js";

function radioTrace(): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-radio",
    tenantId: "tenant-1",
    userId: "user-1",
    automationId: "automation-1",
    websiteUrl: "https://app.example.com/preferences",
    objective: "Choose email delivery",
    browserProfileRef: "profile-1",
    startedAt: "2026-08-27T05:00:00.000Z",
    finishedAt: "2026-08-27T05:01:00.000Z",
    events: [{
      eventId: "delivery-email",
      sequence: 1,
      kind: "INPUT",
      purpose: "WORKFLOW",
      occurredAt: "2026-08-27T05:00:30.000Z",
      page: { url: "https://app.example.com/preferences" },
      target: { role: "radio", accessibleName: "Email", testId: "delivery-email" },
      input: { kind: "RUNTIME_VARIABLE", variableName: "capture_input_1", sensitive: true },
      inputControl: "RADIO",
      expectedEffect: {
        description: "Captured input target remains populated after change",
        mode: "CUSTOM",
        expected: "capture:input-filled",
        timeoutMs: 5_000,
      },
      artifactRefs: [],
    }],
  };
}

describe("captured radio compilation", () => {
  it("compiles the demonstrated radio target into immutable checked-state intent", () => {
    const graph = compileCaptureTrace({
      trace: radioTrace(),
      workflowId: "workflow-radio",
      version: 1,
      createdAt: "2026-08-27T05:02:00.000Z",
    });
    const radio = graph.nodes["capture-1-delivery-email"];
    expect(radio).toMatchObject({
      kind: "CHECK",
      objective: "Select captured radio option for event delivery-email",
      inputBindings: { checked: "capture.delivery-email.checked" },
      allowedSideEffects: ["CHECK"],
      escalation: "HUMAN",
      verification: {
        mode: "CUSTOM",
        expected: "capture:check-bound-state",
        timeoutMs: 5_000,
      },
    });
    expect(graph.initialVariables).toEqual({ "capture.delivery-email.checked": true });
    expect(JSON.stringify(graph)).not.toContain("capture_input_1");
  });

  it("does not reinterpret arbitrary literal input as trusted radio state", () => {
    const trace = radioTrace();
    const events = trace.events.map((event) => ({
      ...event,
      input: { kind: "PUBLIC_LITERAL" as const, value: "email" },
    }));
    expect(() => compileCaptureTrace({
      trace: { ...trace, events },
      workflowId: "workflow-radio-forged",
      version: 1,
      createdAt: "2026-08-27T05:02:00.000Z",
    })).toThrow("uses unsupported radio control");
  });
});
