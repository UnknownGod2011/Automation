const MAX_RUNTIME_INPUTS = 64;
const MAX_VALUE_LENGTH = 4_096;
const MAX_TOTAL_LENGTH = 32_768;
const CAPTURE_RUNTIME_INPUT = /^capture_input_(?:[1-9]\d{0,3})$/;

export interface FreshTestRuntimeInputRequirement {
  key: string;
}

/**
 * Parses the existing Fresh Test JSON field against the closed set of unresolved
 * capture-generated inputs resolved from trusted workflow inspection. The web
 * product cannot use this form to introduce arbitrary workflow variable names.
 */
export function parseFreshTestRuntimeInputForm(
  form: FormData,
  requirements: readonly FreshTestRuntimeInputRequirement[],
): Readonly<Record<string, string>> | null {
  if (requirements.length > MAX_RUNTIME_INPUTS) return null;

  const allowed = new Set<string>();
  for (const requirement of requirements) {
    if (!CAPTURE_RUNTIME_INPUT.test(requirement.key) || allowed.has(requirement.key)) return null;
    allowed.add(requirement.key);
  }

  const entries = form.getAll("runtimeVariables");
  if (entries.length > 1 || (entries.length === 1 && typeof entries[0] !== "string")) return null;
  const raw = typeof entries[0] === "string" ? entries[0].trim() : "";
  if (!raw) return allowed.size === 0 ? undefined : null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const submittedKeys = Object.keys(record);
  if (submittedKeys.length !== allowed.size) return null;
  for (const key of submittedKeys) {
    if (!allowed.has(key)) return null;
  }

  if (allowed.size === 0) return undefined;

  const values: Record<string, string> = {};
  let totalLength = 0;
  for (const runtimeKey of allowed) {
    const value = record[runtimeKey];
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) return null;
    totalLength += value.length;
    if (totalLength > MAX_TOTAL_LENGTH) return null;
    values[runtimeKey] = value;
  }
  return values;
}
