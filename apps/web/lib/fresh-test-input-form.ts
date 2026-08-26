const MAX_RUNTIME_INPUTS = 64;
const MAX_VALUE_LENGTH = 4_096;
const MAX_TOTAL_LENGTH = 32_768;
const CAPTURE_RUNTIME_INPUT = /^capture_input_(?:[1-9]\d{0,3})$/;
const STRUCTURED_INPUT_PREFIX = "runtimeInput-";

export interface FreshTestRuntimeInputRequirement {
  key: string;
}

export interface FreshTestRuntimeInputPresentation {
  required: boolean;
  example: string;
}

export interface FreshTestStructuredInputField {
  name: string;
  ordinal: number;
}

function trustedRuntimeInputKeys(
  requirements: readonly FreshTestRuntimeInputRequirement[],
): readonly string[] | null {
  if (requirements.length > MAX_RUNTIME_INPUTS) return null;

  const allowed = new Set<string>();
  const keys: string[] = [];
  for (const requirement of requirements) {
    if (!CAPTURE_RUNTIME_INPUT.test(requirement.key) || allowed.has(requirement.key)) return null;
    allowed.add(requirement.key);
    keys.push(requirement.key);
  }
  return keys;
}

function boundedValues(
  keys: readonly string[],
  valueForKey: (key: string, index: number) => unknown,
): Readonly<Record<string, string>> | null {
  const values: Record<string, string> = {};
  let totalLength = 0;
  for (const [index, runtimeKey] of keys.entries()) {
    const value = valueForKey(runtimeKey, index);
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) return null;
    totalLength += value.length;
    if (totalLength > MAX_TOTAL_LENGTH) return null;
    values[runtimeKey] = value;
  }
  return values;
}

/**
 * Produces opaque ordinal form-field names for a guided Fresh Test UI. The browser
 * does not need to submit capture_input_N keys back to the server; the server maps
 * each ordinal to the trusted workflow requirement in its immutable order.
 */
export function freshTestStructuredInputFields(
  requirements: readonly FreshTestRuntimeInputRequirement[],
): readonly FreshTestStructuredInputField[] | null {
  const keys = trustedRuntimeInputKeys(requirements);
  if (!keys) return null;
  return keys.map((_, index) => ({
    name: `${STRUCTURED_INPUT_PREFIX}${index + 1}`,
    ordinal: index + 1,
  }));
}

/**
 * Produces the legacy JSON Fresh Test form shape from the same closed trusted
 * requirement set used by the server-side parser. Existing callers remain
 * compatible while the product moves toward guided per-input fields.
 */
export function freshTestRuntimeInputPresentation(
  requirements: readonly FreshTestRuntimeInputRequirement[],
): FreshTestRuntimeInputPresentation | null {
  const keys = trustedRuntimeInputKeys(requirements);
  if (!keys) return null;
  if (keys.length === 0) return { required: false, example: "" };
  return {
    required: true,
    example: JSON.stringify(Object.fromEntries(keys.map((key) => [key, ""])), null, 2),
  };
}

/**
 * Parses Fresh Test runtime values against the closed set of unresolved
 * capture-generated inputs resolved from trusted workflow inspection.
 *
 * The existing JSON field remains accepted for compatibility. The guided product
 * form instead submits ordinal runtimeInput-N fields; those names carry no workflow
 * authority and are mapped back to trusted capture_input_N keys only on the server.
 * Mixing both representations, missing fields, duplicate fields, or forged ordinal
 * fields fails closed before AgentCore execution.
 */
export function parseFreshTestRuntimeInputForm(
  form: FormData,
  requirements: readonly FreshTestRuntimeInputRequirement[],
): Readonly<Record<string, string>> | null | undefined {
  const keys = trustedRuntimeInputKeys(requirements);
  if (!keys) return null;

  const structuredNames = [...new Set(
    [...form.keys()].filter((name) => name.startsWith(STRUCTURED_INPUT_PREFIX)),
  )];
  const jsonEntries = form.getAll("runtimeVariables");

  if (structuredNames.length > 0) {
    if (jsonEntries.length > 0 || keys.length === 0) return null;
    const expectedNames = keys.map((_, index) => `${STRUCTURED_INPUT_PREFIX}${index + 1}`);
    if (
      structuredNames.length !== expectedNames.length
      || structuredNames.some((name) => !expectedNames.includes(name))
    ) {
      return null;
    }
    for (const name of expectedNames) {
      if (form.getAll(name).length !== 1) return null;
    }
    return boundedValues(keys, (_key, index) => form.get(expectedNames[index]!));
  }

  if (jsonEntries.length > 1 || (jsonEntries.length === 1 && typeof jsonEntries[0] !== "string")) return null;
  const raw = typeof jsonEntries[0] === "string" ? jsonEntries[0].trim() : "";
  if (!raw) return keys.length === 0 ? undefined : null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const submittedKeys = Object.keys(record);
  if (submittedKeys.length !== keys.length) return null;
  const allowed = new Set(keys);
  for (const key of submittedKeys) {
    if (!allowed.has(key)) return null;
  }

  if (keys.length === 0) return undefined;
  return boundedValues(keys, (runtimeKey) => record[runtimeKey]);
}
