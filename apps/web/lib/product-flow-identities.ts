import type { AutomationSummaryView, RunSummaryView } from "@automation/core";

export function workflowIdForAutomation(automationId: string): string {
  const normalized = automationId.trim();
  if (!normalized) throw new Error("automationId is required");
  return normalized;
}

export function freshTestRunId(randomId: () => string = () => crypto.randomUUID()): string {
  const suffix = randomId().trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(suffix)) {
    throw new Error("fresh test identity is invalid");
  }
  return `test-${suffix}`;
}

/**
 * Resolve the only workflow version the web product may ask the control plane
 * to publish. The browser never supplies this value.
 *
 * READY_TO_PUBLISH is set only after a successful fresh test, and compiling a
 * newer workflow moves the automation back to READY_TO_TEST. Publish selection
 * still verifies durable run provenance explicitly: only successful FRESH_TEST
 * runs are candidates. A scheduled success, legacy/unknown run kind, failed run,
 * or malformed workflow version can never authorize publication at this layer.
 * The lifecycle's latest-workflow check remains the final authority against
 * stale or corrupt state.
 */
export function serverResolvedPublishWorkflowVersion(
  automation: Pick<AutomationSummaryView, "status">,
  runs: readonly Pick<RunSummaryView, "status" | "workflowVersion" | "runKind">[],
): number | null {
  if (automation.status !== "READY_TO_PUBLISH") return null;

  let candidate: number | null = null;
  for (const run of runs) {
    if (run.runKind !== "FRESH_TEST" || run.status !== "SUCCEEDED") continue;
    if (!Number.isInteger(run.workflowVersion) || run.workflowVersion < 1) continue;
    candidate = candidate === null ? run.workflowVersion : Math.max(candidate, run.workflowVersion);
  }
  return candidate;
}
