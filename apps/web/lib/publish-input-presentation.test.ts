import { describe, expect, it } from "vitest";
import { publishRuntimeInputFields } from "./publish-input-presentation";

describe("publish runtime input presentation", () => {
  it("keeps opaque ordinal fields aligned with trusted TYPE and SELECT semantics", () => {
    expect(publishRuntimeInputFields({
      nodes: [
        { step: 2, kind: "TYPE" },
        { step: 7, kind: "SELECT" },
      ],
      runtimeInputs: [
        { key: "capture_input_7", step: 7 },
        { key: "capture_input_2", step: 2 },
      ],
    })).toEqual([
      {
        name: "scheduledInput-1",
        ordinal: 1,
        step: 7,
        kind: "SELECT",
        label: "Step 7 option label",
        guidance: "Enter the visible option label this step should select.",
      },
      {
        name: "scheduledInput-2",
        ordinal: 2,
        step: 2,
        kind: "TEXT",
        label: "Step 2 text value",
        guidance: "Enter the non-secret text this step should type.",
      },
    ]);
  });

  it("fails closed when semantic metadata is unsupported or a capture key is invalid", () => {
    expect(publishRuntimeInputFields({
      nodes: [{ step: 1, kind: "CLICK" }],
      runtimeInputs: [{ key: "capture_input_1", step: 1 }],
    })).toBeNull();

    expect(publishRuntimeInputFields({
      nodes: [{ step: 1, kind: "TYPE" }],
      runtimeInputs: [{ key: "customer.email", step: 1 }],
    })).toBeNull();
  });

  it("accepts a workflow with no unresolved captured values", () => {
    expect(publishRuntimeInputFields({
      nodes: [{ step: 1, kind: "NAVIGATE" }],
      runtimeInputs: [],
    })).toEqual([]);
  });
});
