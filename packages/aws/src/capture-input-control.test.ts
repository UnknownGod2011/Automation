import { describe, expect, it } from "vitest";
import { classifyCaptureInputControl } from "./capture-collector.js";

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

  it("preserves unsupported control semantics instead of pretending they are text inputs", () => {
    expect(classifyCaptureInputControl("select")).toBe("SELECT");
    expect(classifyCaptureInputControl("checkbox")).toBe("CHECKBOX");
    expect(classifyCaptureInputControl("radio")).toBe("RADIO");
    expect(classifyCaptureInputControl("file")).toBe("FILE");
    expect(classifyCaptureInputControl("password")).toBe("PASSWORD");
    expect(classifyCaptureInputControl("color")).toBe("OTHER");
    expect(classifyCaptureInputControl(undefined)).toBe("OTHER");
  });
});
