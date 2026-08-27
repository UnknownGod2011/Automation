import {
  runtimeInputSemanticPresentations,
  type RuntimeInputSemanticPresentation,
  type RuntimeInputSemanticWorkflow,
} from "./runtime-input-presentation";
import { scheduledStructuredInputFields } from "./scheduled-input-form";

export interface PublishRuntimeInputWorkflow {
  nodes: RuntimeInputSemanticWorkflow["nodes"];
  runtimeInputs: readonly { key: string; step: number }[];
}

export interface PublishRuntimeInputField extends RuntimeInputSemanticPresentation {
  name: string;
  ordinal: number;
}

/**
 * Aligns the browser-visible ordinal Publish fields with the already-sanitized
 * semantic workflow inspection. Internal capture_input_N keys stay server-side;
 * malformed or unsupported metadata fails closed instead of guessing labels.
 */
export function publishRuntimeInputFields(
  workflow: PublishRuntimeInputWorkflow,
): readonly PublishRuntimeInputField[] | null {
  const fields = scheduledStructuredInputFields(workflow.runtimeInputs);
  const semanticInputs = runtimeInputSemanticPresentations(workflow);
  if (!fields || !semanticInputs || fields.length !== semanticInputs.length) return null;

  return fields.map((field, index) => ({
    ...field,
    ...semanticInputs[index]!,
  }));
}
