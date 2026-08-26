import { describe, expect, it } from "vitest";
import {
  parseScheduledGuidedInputForm,
  parseScheduledInputForm,
  parseScheduledPublishInputForm,
  scheduledStructuredInputFields,
} from "./scheduled-input-form";

describe("scheduled input forms", () => {
  it("accepts explicitly acknowledged legacy JSON values", () => {
    expect(parseScheduledInputForm('{"capture_input_3":"ops@example.test"}', true)).toEqual({
      values: { capture_input_3: "ops@example.test" },
      acknowledged: true,
    });
  });

  it("rejects legacy persisted values without acknowledgement and malformed/non-string data", () => {
    expect(parseScheduledInputForm('{"capture_input_3":"ops@example.test"}', false)).toBeNull();
    expect(parseScheduledInputForm('{"capture_input_3":7}', true)).toBeNull();
    expect(parseScheduledInputForm("not-json", true)).toBeNull();
  });

  it("allows workflows with no legacy scheduled input payload", () => {
    expect(parseScheduledInputForm("", false)).toEqual({ acknowledged: false });
  });

  it("maps guided ordinal fields only to the trusted workflow requirement order", () => {
    const requirements = [{ key: "capture_input_2" }, { key: "capture_input_7" }];
    expect(scheduledStructuredInputFields(requirements)).toEqual([
      { name: "scheduledInput-1", ordinal: 1 },
      { name: "scheduledInput-2", ordinal: 2 },
    ]);

    const form = new FormData();
    form.set("scheduledInput-1", "High");
    form.set("scheduledInput-2", "Acme note");
    form.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(form, requirements)).toEqual({
      values: { capture_input_2: "High", capture_input_7: "Acme note" },
      acknowledged: true,
    });
  });

  it("accepts guided Publish values and maps them server-side", () => {
    const form = new FormData();
    form.set("kind", "DAILY");
    form.set("expression", "09:00");
    form.set("timezone", "Asia/Kolkata");
    form.set("scheduledInput-1", "High");
    form.set("scheduledInput-2", "Acme note");
    form.set("scheduledInputsAreNonSecret", "yes");

    expect(parseScheduledPublishInputForm(form, [
      { key: "capture_input_2" },
      { key: "capture_input_7" },
    ])).toEqual({
      values: { capture_input_2: "High", capture_input_7: "Acme note" },
      acknowledged: true,
    });
  });

  it("allows Publish with no unresolved captured inputs and no acknowledgement", () => {
    const form = new FormData();
    form.set("kind", "DAILY");
    form.set("expression", "09:00");
    form.set("timezone", "Asia/Kolkata");
    expect(parseScheduledPublishInputForm(form, [])).toEqual({ acknowledged: false });
  });

  it("rejects legacy JSON or fabricated guided values at the Publish boundary", () => {
    const legacy = new FormData();
    legacy.set("scheduledNonSecretInputs", '{"capture_input_1":"legacy"}');
    legacy.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledPublishInputForm(legacy, [{ key: "capture_input_1" }])).toBeNull();

    const forged = new FormData();
    forged.set("scheduledInput-2", "forged");
    forged.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledPublishInputForm(forged, [{ key: "capture_input_1" }])).toBeNull();

    const unexpectedForEmptyWorkflow = new FormData();
    unexpectedForEmptyWorkflow.set("scheduledInput-1", "forged");
    expect(parseScheduledPublishInputForm(unexpectedForEmptyWorkflow, [])).toBeNull();
  });

  it("rejects forged, missing, duplicate, mixed, or unacknowledged guided fields", () => {
    const requirements = [{ key: "capture_input_1" }];

    const forged = new FormData();
    forged.set("scheduledInput-2", "forged");
    forged.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(forged, requirements)).toBeNull();

    const missing = new FormData();
    missing.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(missing, requirements)).toBeNull();

    const duplicate = new FormData();
    duplicate.append("scheduledInput-1", "first");
    duplicate.append("scheduledInput-1", "second");
    duplicate.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(duplicate, requirements)).toBeNull();

    const mixed = new FormData();
    mixed.set("scheduledInput-1", "guided");
    mixed.set("scheduledNonSecretInputs", '{"capture_input_1":"json"}');
    mixed.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(mixed, requirements)).toBeNull();

    const unacknowledged = new FormData();
    unacknowledged.set("scheduledInput-1", "value");
    expect(parseScheduledGuidedInputForm(unacknowledged, requirements)).toBeNull();
  });

  it("fails closed on malformed trusted requirement metadata", () => {
    const form = new FormData();
    form.set("scheduledInput-1", "value");
    form.set("scheduledInputsAreNonSecret", "yes");
    expect(parseScheduledGuidedInputForm(form, [{ key: "customer.email" }])).toBeNull();
    expect(parseScheduledGuidedInputForm(form, [{ key: "capture_input_1" }, { key: "capture_input_1" }])).toBeNull();
    expect(parseScheduledPublishInputForm(form, [{ key: "customer.email" }])).toBeNull();
  });
});
