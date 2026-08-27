import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import { compileCaptureTrace } from "./workflow-compiler.js";

function multiSelectTrace(): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-multi-select",
    tenantId: "tenant-a",
    userId: "user-a",
    automationId: "automation-a",
    websiteUrl: "https://example.com/app",
    objective: "Choose several categories",
    browserProfileRef: "profile-a",
    startedAt: "2026-08-27T09:00:00.000Z",
    finishedAt: "2026-08-27T09:01:00.000Z",
    events: [{
      eventId: "categories",
      sequence: 1,
      kind: "INPUT",
      purpose: "WORKFLOW",
      occurredAt: "2026-08-27T09:00:30.000Z",
      page: { url: "https://example.com/app" },
      target: { role: "listbox", accessibleName: "Categories", testId: "categories" },
      input: { kind: "RUNTIME_VARIABLE", variableName: "capture_input_1", sensitive: true },
      // Production capture classifies native <select multiple> as OTHER until an
      // explicit list-valued workflow primitive and verification contract exist.
      inputControl: "OTHER",
      expectedEffect: {
        description: "Captured input target remains populated after selection",
        mode: "CUSTOM",
        expected: "capture:input-filled",
        timeoutMs: 5_000,
      },
      artifactRefs: [],
    }],
  };
}

describe("multi-select workflow compilation", () => {
  it("fails closed instead of compiling a multiple select through the single-value SELECT primitive", () => {
    expect(() => compileCaptureTrace({
      trace: multiSelectTrace(),
      workflowId: "workflow-a",
      version: 1,
      createdAt: "2026-08-27T09:02:00.000Z",
    })).toThrow("uses unsupported other control");
  });
});
