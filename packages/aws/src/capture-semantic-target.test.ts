import { describe, expect, it } from "vitest";
import {
  CAPTURE_INSTALLER,
  inferCaptureNativeRole,
  selectCaptureAccessibleName,
} from "./capture-collector.js";

describe("capture semantic target metadata", () => {
  it("infers common native control roles without requiring explicit ARIA", () => {
    expect(inferCaptureNativeRole("button")).toBe("button");
    expect(inferCaptureNativeRole("a", undefined, false, true)).toBe("link");
    expect(inferCaptureNativeRole("textarea")).toBe("textbox");
    expect(inferCaptureNativeRole("select", "select", false)).toBe("combobox");
    expect(inferCaptureNativeRole("select", "select-multiple", true)).toBe("listbox");
    expect(inferCaptureNativeRole("input", "text")).toBe("textbox");
    expect(inferCaptureNativeRole("input", "search")).toBe("searchbox");
    expect(inferCaptureNativeRole("input", "number")).toBe("spinbutton");
    expect(inferCaptureNativeRole("input", "checkbox")).toBe("checkbox");
    expect(inferCaptureNativeRole("input", "radio")).toBe("radio");
    expect(inferCaptureNativeRole("input", "submit")).toBe("button");
    expect(inferCaptureNativeRole("div")).toBeUndefined();
  });

  it("chooses a bounded non-empty accessible name without reading field values", () => {
    expect(selectCaptureAccessibleName(undefined, "  ", " Priority ", "Fallback"))
      .toBe("Priority");
    expect(selectCaptureAccessibleName("x".repeat(700))).toHaveLength(512);
    expect(selectCaptureAccessibleName(undefined, "   ")).toBeUndefined();

    expect(CAPTURE_INSTALLER).toContain("inferCaptureNativeRole");
    expect(CAPTURE_INSTALLER).toContain("selectCaptureAccessibleName");
    expect(CAPTURE_INSTALLER).toContain("aria-labelledby");
    expect(CAPTURE_INSTALLER).not.toContain("element.value");
  });
});
