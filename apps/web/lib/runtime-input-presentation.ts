export interface RuntimeInputSemanticWorkflow {
  nodes: readonly { step: number; kind: string }[];
  runtimeInputs: readonly { step: number }[];
}

export interface RuntimeInputSemanticPresentation {
  step: number;
  kind: "TEXT" | "SELECT";
  label: string;
  guidance: string;
}

/**
 * Turns trusted workflow-inspection metadata into user-facing input guidance.
 * The browser still submits only opaque ordinal field names; this helper never
 * receives or exposes capture_input_N keys, selectors, values, or durable node IDs.
 */
export function runtimeInputSemanticPresentations(
  workflow: RuntimeInputSemanticWorkflow,
): readonly RuntimeInputSemanticPresentation[] | null {
  const nodesByStep = new Map<number, { step: number; kind: string }>();
  for (const node of workflow.nodes) {
    if (!Number.isInteger(node.step) || node.step < 1 || nodesByStep.has(node.step)) return null;
    nodesByStep.set(node.step, node);
  }

  const presentations: RuntimeInputSemanticPresentation[] = [];
  for (const input of workflow.runtimeInputs) {
    if (!Number.isInteger(input.step) || input.step < 1) return null;
    const node = nodesByStep.get(input.step);
    if (!node) return null;

    if (node.kind === "TYPE") {
      presentations.push({
        step: input.step,
        kind: "TEXT",
        label: `Step ${input.step} text value`,
        guidance: "Enter the non-secret text this step should type.",
      });
      continue;
    }
    if (node.kind === "SELECT") {
      presentations.push({
        step: input.step,
        kind: "SELECT",
        label: `Step ${input.step} option label`,
        guidance: "Enter the visible option label this step should select.",
      });
      continue;
    }

    // Capture-generated runtime inputs are currently valid only for TYPE and
    // deterministic single-value SELECT. Unknown metadata must not be guessed at.
    return null;
  }
  return presentations;
}
