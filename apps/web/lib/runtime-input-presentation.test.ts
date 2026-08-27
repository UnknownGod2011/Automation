import { describe, expect, it } from "vitest";
import { runtimeInputSemanticPresentations } from "./runtime-input-presentation";

describe("runtime input semantic presentation", () => {
  it("labels captured text and select values by their semantic workflow step", () => {
    expect(runtimeInputSemanticPresentations({
      nodes: [
        { step: 1, kind: "NAVIGATE" },
        { step: 2, kind: "SELECT" },
        { step: 3, kind: "TYPE" },
      ],
      runtimeInputs: [{ step: 2 }, { step: 3 }],
    })).toEqual([
      {
        step: 2,
        kind: "SELECT",
        label: "Step 2 option label",
        guidance: "Enter the visible option label this step should select.",
      },
      {
        step: 3,
        kind: "TEXT",
        label: "Step 3 text value",
        guidance: "Enter the non-secret text this step should type.",
      },
    ]);
  });

  it("preserves trusted runtime-input ordering rather than sorting browser-visible fields", () => {
    expect(runtimeInputSemanticPresentations({
      nodes: [
        { step: 2, kind: "TYPE" },
        { step: 7, kind: "SELECT" },
      ],
      runtimeInputs: [{ step: 7 }, { step: 2 }],
    })?.map((input) => input.step)).toEqual([7, 2]);
  });

  it("fails closed for missing, duplicate, malformed, or unsupported semantic step metadata", () => {
    expect(runtimeInputSemanticPresentations({
      nodes: [{ step: 1, kind: "TYPE" }],
      runtimeInputs: [{ step: 2 }],
    })).toBeNull();

    expect(runtimeInputSemanticPresentations({
      nodes: [{ step: 1, kind: "TYPE" }, { step: 1, kind: "SELECT" }],
      runtimeInputs: [{ step: 1 }],
    })).toBeNull();

    expect(runtimeInputSemanticPresentations({
      nodes: [{ step: 0, kind: "TYPE" }],
      runtimeInputs: [{ step: 0 }],
    })).toBeNull();

    expect(runtimeInputSemanticPresentations({
      nodes: [{ step: 1, kind: "CLICK" }],
      runtimeInputs: [{ step: 1 }],
    })).toBeNull();
  });

  it("accepts workflows with no unresolved runtime values", () => {
    expect(runtimeInputSemanticPresentations({
      nodes: [{ step: 1, kind: "NAVIGATE" }],
      runtimeInputs: [],
    })).toEqual([]);
  });
});
