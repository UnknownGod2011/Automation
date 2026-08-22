const MAX_VALUES = 64;
const MAX_VALUE_CHARS = 4_096;

export interface ScheduledInputFormPayload {
  values?: Readonly<Record<string, string>>;
  acknowledged: boolean;
}

export function parseScheduledInputForm(raw: string, acknowledged: boolean): ScheduledInputFormPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return { acknowledged };
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_VALUES || (entries.length > 0 && !acknowledged)) return null;
  const values: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length > MAX_VALUE_CHARS) return null;
    values[key] = value;
  }
  return { values, acknowledged };
}
