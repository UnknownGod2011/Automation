import type { RunSemanticProgressView, RunSemanticStepView } from "@automation/core";

export type RunTimelineState = "COMPLETED" | "CURRENT" | "FAILED";

export interface RunTimelineEntry extends RunSemanticStepView {
  state: RunTimelineState;
}

export function buildRunTimeline(
  semantic: RunSemanticProgressView | undefined,
): readonly RunTimelineEntry[] {
  if (!semantic) return [];

  const timeline: RunTimelineEntry[] = semantic.completed.map((step) => ({
    ...step,
    state: "COMPLETED" as const,
  }));

  const active = semantic.failure ?? semantic.current;
  if (active) {
    timeline.push({
      ...active,
      state: semantic.failure ? "FAILED" : "CURRENT",
    });
  }

  return timeline;
}

export function runTimelineStateLabel(state: RunTimelineState): string {
  switch (state) {
    case "COMPLETED":
      return "Completed";
    case "CURRENT":
      return "Current";
    case "FAILED":
      return "Failed / needs attention";
  }
}
