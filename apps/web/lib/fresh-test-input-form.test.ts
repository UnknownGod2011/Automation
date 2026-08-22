import { describe, expect, it } from "vitest";
import {
  freshTestRuntimeInputPresentation,
  parseFreshTestRuntimeInputForm,
} from "./fresh-test-input-form";

const requirements = [
  { key: "capture_input_1" },
  { key: "capture_input_7" },
] as const;

function formWithRuntimeJson(value: string): FormData {
  const form = new FormData();
  form.set("runtimeVariables", value);
  return form;
}

describe("fresh-test runtime input form", () => {
  it("accepts exactly the trusted capture-generated inputs", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({
      capture_input_1: "Acme",
      capture_input_7: "Approved",
    })), requirements)).toEqual({ capture_input_1: "Acme", capture_input_7: "Approved" });
  });

  it("allows an intentionally empty typed value", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({
      capture_input_1: "",
      capture_input_7: "Approved",
    })), requirements)?.capture_input_1).toBe("");
  });

  it("rejects missing or forged variable names", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({ capture_input_1: "Acme" })), requirements)).toBeNull();
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({
      capture_input_1: "Acme",
      capture_input_7: "Approved",
      api_token: "secret",
    })), requirements)).toBeNull();
  });

  it("rejects malformed, non-object, non-string, or duplicate submissions", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson("{"), requirements)).toBeNull();
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson("[]"), requirements)).toBeNull();
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({
      capture_input_1: 1,
      capture_input_7: "Approved",
    })), requirements)).toBeNull();

    const duplicate = formWithRuntimeJson("{}");
    duplicate.append("runtimeVariables", "{}");
    expect(parseFreshTestRuntimeInputForm(duplicate, [])).toBeNull();
  });

  it("rejects oversized values and total payloads", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({
      capture_input_1: "x".repeat(4_097),
      capture_input_7: "ok",
    })), requirements)).toBeNull();

    const manyRequirements = Array.from({ length: 9 }, (_, index) => ({ key: `capture_input_${index + 1}` }));
    const values = Object.fromEntries(manyRequirements.map((requirement) => [requirement.key, "x".repeat(4_000)]));
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify(values)), manyRequirements)).toBeNull();
  });

  it("accepts an empty form or empty object when no capture input is required", () => {
    expect(parseFreshTestRuntimeInputForm(new FormData(), [])).toBeUndefined();
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson("{}"), [])).toBeUndefined();
  });

  it("rejects arbitrary runtime variables when the trusted workflow requires none", () => {
    expect(parseFreshTestRuntimeInputForm(formWithRuntimeJson(JSON.stringify({ customer: "Acme" })), [])).toBeNull();
  });

  it("rejects malformed or duplicate trusted requirements", () => {
    expect(parseFreshTestRuntimeInputForm(new FormData(), [{ key: "customer.email" }])).toBeNull();
    expect(parseFreshTestRuntimeInputForm(new FormData(), [{ key: "capture_input_1" }, { key: "capture_input_1" }])).toBeNull();
  });

  it("builds the Fresh Test example from exactly the trusted required keys", () => {
    expect(freshTestRuntimeInputPresentation(requirements)).toEqual({
      required: true,
      example: JSON.stringify({ capture_input_1: "", capture_input_7: "" }, null, 2),
    });
  });

  it("does not suggest arbitrary JSON when the workflow requires no runtime input", () => {
    expect(freshTestRuntimeInputPresentation([])).toEqual({ required: false, example: "" });
  });

  it("fails closed when the trusted requirements are malformed", () => {
    expect(freshTestRuntimeInputPresentation([{ key: "customer.email" }])).toBeNull();
    expect(freshTestRuntimeInputPresentation([{ key: "capture_input_1" }, { key: "capture_input_1" }])).toBeNull();
  });
});
