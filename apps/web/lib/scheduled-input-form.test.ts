import { describe, expect, it } from "vitest";
import { parseScheduledInputForm } from "./scheduled-input-form";

describe("parseScheduledInputForm", () => {
  it("accepts explicitly acknowledged non-secret string values", () => {
    expect(parseScheduledInputForm('{"capture_input_3":"ops@example.test"}', true)).toEqual({ values: { capture_input_3: "ops@example.test" }, acknowledged: true });
  });
  it("rejects persisted values without acknowledgement and malformed/non-string data", () => {
    expect(parseScheduledInputForm('{"capture_input_3":"ops@example.test"}', false)).toBeNull();
    expect(parseScheduledInputForm('{"capture_input_3":7}', true)).toBeNull();
    expect(parseScheduledInputForm("not-json", true)).toBeNull();
  });
  it("allows workflows with no scheduled input payload", () => {
    expect(parseScheduledInputForm("", false)).toEqual({ acknowledged: false });
  });
});
