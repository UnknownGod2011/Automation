import type { WorkflowGraph } from "@automation/contracts";

const CAPTURE_RUNTIME_INPUT = /^capture_input_(?:[1-9]\d{0,3})$/;
const MAX_SCHEDULED_INPUTS = 64;
const MAX_SCHEDULED_INPUT_VALUE_CHARS = 4_096;
const MAX_SCHEDULED_INPUT_TOTAL_CHARS = 32_768;

function own(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isCaptureRuntimeInputKey(value: string): boolean {
  return CAPTURE_RUNTIME_INPUT.test(value);
}

export function requiredScheduledCaptureInputs(graph: WorkflowGraph): readonly string[] {
  const seeded = graph.initialVariables ?? {};
  const required = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    for (const binding of Object.values(node.inputBindings)) {
      if (isCaptureRuntimeInputKey(binding) && !own(seeded, binding)) required.add(binding);
    }
  }
  return [...required].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function validateScheduledNonSecretInputs(
  graph: WorkflowGraph,
  values: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> {
  const required = requiredScheduledCaptureInputs(graph);
  const requiredSet = new Set(required);
  const entries = Object.entries(values ?? {});
  if (entries.length > MAX_SCHEDULED_INPUTS) {
    throw new Error("too many scheduled non-secret inputs");
  }

  let totalChars = 0;
  const supplied = new Map<string, string>();
  for (const [key, value] of entries) {
    if (!requiredSet.has(key)) throw new Error("scheduled input does not belong to this workflow");
    if (typeof value !== "string") throw new Error("scheduled non-secret input values must be strings");
    if (value.length > MAX_SCHEDULED_INPUT_VALUE_CHARS) {
      throw new Error("scheduled non-secret input value is too long");
    }
    totalChars += value.length;
    if (totalChars > MAX_SCHEDULED_INPUT_TOTAL_CHARS) {
      throw new Error("scheduled non-secret inputs are too large");
    }
    supplied.set(key, value);
  }

  const normalized: Record<string, string> = {};
  for (const key of required) {
    if (!supplied.has(key)) throw new Error("published workflow requires scheduled non-secret inputs");
    normalized[key] = supplied.get(key)!;
  }
  return normalized;
}
