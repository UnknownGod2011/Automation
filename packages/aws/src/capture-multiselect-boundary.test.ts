import { describe, expect, it } from "vitest";
import {
  CAPTURE_INSTALLER,
  classifyCaptureInputControl,
  shouldSuppressDiscreteControlClick,
} from "./capture-collector.js";

describe("multi-select capture boundary", () => {
  it("distinguishes native multiple selects from supported single-select controls", () => {
    expect(classifyCaptureInputControl("select")).toBe("SELECT");
    expect(classifyCaptureInputControl("select-multiple")).toBe("OTHER");
    expect(shouldSuppressDiscreteControlClick("select")).toBe(true);
    expect(shouldSuppressDiscreteControlClick("select-multiple")).toBe(true);
    expect(shouldSuppressDiscreteControlClick("text")).toBe(false);
  });

  it("instruments both click and change paths with the multiple-select marker", () => {
    const markers = CAPTURE_INSTALLER.match(/select-multiple/g) ?? [];
    expect(markers.length).toBeGreaterThanOrEqual(2);
    expect(CAPTURE_INSTALLER).toContain('element.multiple ? "select-multiple" : "select"');
  });
});
