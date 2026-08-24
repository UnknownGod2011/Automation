import type { RunDetailView } from "@automation/core";

/**
 * Presentation-only check for whether the authenticated run detail advertises an
 * explicit HUMAN continuation. Durable paused-node selection remains exclusively
 * inside the provider-neutral control-plane resume service.
 */
export function serverAllowsHumanResume(run: RunDetailView): boolean {
  return run.status === "WAITING_FOR_HUMAN" && run.humanResumeEligible;
}
