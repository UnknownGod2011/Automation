import { describe, expect, it } from "vitest";
import {
  captureInputDescriptor,
  classifyCaptureInputControl,
} from "./capture-collector.js";

describe("capture input control classification", () => {
  it("keeps fill-compatible text controls on the TYPE path", () => {
    for (const inputType of [
      "textarea",
      "text",
      "search",
      "email",
      "url",
      "tel",
      "number",
      "date",
      "time",
      "datetime-local",
      "month",
      "week",
    ]) {
      expect(classifyCaptureInputControl(inputType)).toBe("TEXT");
    }
  });

  it("preserves form-control semantics instead of pretending they are text inputs", () => {
    expect(classifyCaptureInputControl("select")).toBe("SELECT");
    expect(classifyCaptureInputControl("checkbox")).toBe("CHECKBOX");
    expect(classifyCaptureInputControl("radio")).toBe("RADIO");
    expect(classifyCaptureInputControl("file")).toBe("FILE");
    expect(classifyCaptureInputControl("password")).toBe("PASSWORD");
    expect(classifyCaptureInputControl("color")).toBe("OTHER");
    expect(classifyCaptureInputControl(undefined)).toBe("OTHER");
  });

  it("captures only the boolean state for checkbox changes", () => {
    expect(captureInputDescriptor("CHECKBOX", "capture_input_1", true)).toEqual({
      input: { kind: "PUBLIC_LITERAL", value: "true" },
      expectedEffect: {
        description: "Captured checkbox remains in the demonstrated state",
        mode: "CUSTOM",
        expected: "capture:check-bound-state",
        timeoutMs: 5_000,
      },
    });
    expect(captureInputDescriptor("CHECKBOX", "capture_input_1", false).input).toEqual({
      kind: "PUBLIC_LITERAL",
      value: "false",
    });
  });

  it("never invents a checkbox state when browser capture data is malformed", () => {
    expect(() => captureInputDescriptor("CHECKBOX", "capture_input_1", undefined))
      .toThrow("captured checkbox state is required");
  });

  it("keeps other captured values on the unresolved runtime-input boundary", () => {
    expect(captureInputDescriptor("SELECT", "capture_input_4", undefined).input).toEqual({
      kind: "RUNTIME_VARIABLE",
      variableName: "capture_input_4",
      sensitive: true,
    });
  });
});