import type { RunDetailView } from "@automation/core";

/**
 * Resolves the paused node exclusively from the latest authenticated server-side
 * run detail. Browser form fields never choose the durable resume boundary.
 */
export function serverResolvedHumanResumeNode(run: RunDetailView): string | null {
  if (!run.humanResumeEligible) return null;
  const runNodeId = run.currentNodeId;
  const checkpointNodeId = run.checkpoint?.currentNodeId;
  if (runNodeId && checkpointNodeId && runNodeId !== checkpointNodeId) return null;
  return checkpointNodeId ?? runNodeId ?? null;
}
