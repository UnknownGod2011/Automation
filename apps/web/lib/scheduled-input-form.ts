const MAX_VALUES = 64;
const MAX_VALUE_CHARS = 4_096;
const MAX_TOTAL_CHARS = 32_768;
const CAPTURE_RUNTIME_INPUT = /^capture_input_(?:[1-9]\d{0,3})$/;
const STRUCTURED_INPUT_PREFIX = "scheduledInput-";

export interface ScheduledInputFormPayload {
  values?: Readonly<Record<string, string>>;
  acknowledged: boolean;
}

export interface ScheduledInputRequirement {
  key: string;
}

export interface ScheduledStructuredInputField {
  name: string;
  ordinal: number;
}

function trustedRequirementKeys(
  requirements: readonly ScheduledInputRequirement[],
): readonly string[] | null {
  if (requirements.length > MAX_VALUES) return null;
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const requirement of requirements) {
    if (!CAPTURE_RUNTIME_INPUT.test(requirement.key) || seen.has(requirement.key)) return null;
    seen.add(requirement.key);
    keys.push(requirement.key);
  }
  return keys;
}

function boundedValues(
  keys: readonly string[],
  valueForKey: (key: string, index: number) => unknown,
): Readonly<Record<string, string>> | null {
  const values: Record<string, string> = {};
  let totalChars = 0;
  for (const [index, key] of keys.entries()) {
    const value = valueForKey(key, index);
    if (typeof value !== "string" || value.length > MAX_VALUE_CHARS) return null;
    totalChars += value.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    values[key] = value;
  }
  return values;
}

export function scheduledStructuredInputFields(
  requirements: readonly ScheduledInputRequirement[],
): readonly ScheduledStructuredInputField[] | null {
  const keys = trustedRequirementKeys(requirements);
  if (!keys) return null;
  return keys.map((_, index) => ({
    name: `${STRUCTURED_INPUT_PREFIX}${index + 1}`,
    ordinal: index + 1,
  }));
}

/** Legacy JSON parser retained for the existing publish form. */
export function parseScheduledInputForm(raw: string, acknowledged: boolean): ScheduledInputFormPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return { acknowledged };
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_VALUES || (entries.length > 0 && !acknowledged)) return null;
  const values: Record<string, string> = {};
  let totalChars = 0;
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length > MAX_VALUE_CHARS) return null;
    totalChars += value.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    values[key] = value;
  }
  return { values, acknowledged };
}

/**
 * Parses the primary scheduled-input settings form against the trusted immutable
 * workflow requirements. Browser-visible ordinal names carry no workflow-variable
 * authority; only this server-side mapping can produce capture_input_N keys.
 */
export function parseScheduledGuidedInputForm(
  form: FormData,
  requirements: readonly ScheduledInputRequirement[],
): ScheduledInputFormPayload | null {
  const keys = trustedRequirementKeys(requirements);
  if (!keys || keys.length === 0) return null;

  const acknowledgement = form.getAll("scheduledInputsAreNonSecret");
  if (acknowledgement.length !== 1 || acknowledgement[0] !== "yes") return null;

  const expectedNames = keys.map((_, index) => `${STRUCTURED_INPUT_PREFIX}${index + 1}`);
  const submittedNames = [...new Set([...form.keys()].filter((name) => name.startsWith(STRUCTURED_INPUT_PREFIX)))];
  if (
    submittedNames.length !== expectedNames.length
    || submittedNames.some((name) => !expectedNames.includes(name))
    || form.getAll("scheduledNonSecretInputs").length > 0
  ) {
    return null;
  }
  for (const name of expectedNames) {
    if (form.getAll(name).length !== 1) return null;
  }

  const values = boundedValues(keys, (_key, index) => form.get(expectedNames[index]!));
  return values ? { values, acknowledged: true } : null;
}
