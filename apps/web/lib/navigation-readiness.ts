import type { NewAutomationAccess } from "./new-automation-access";

export type AuthenticatedNavigationPresentation =
  | { kind: "READY" }
  | { kind: "CONTROL_PLANE_UNAVAILABLE"; message: string };

/**
 * Presentation-only navigation gate for authenticated control-plane actions.
 * Server/API authorization remains authoritative for every mutation.
 */
export function authenticatedNavigationPresentation(
  access: NewAutomationAccess,
): AuthenticatedNavigationPresentation {
  return access.kind === "READY"
    ? { kind: "READY" }
    : {
        kind: "CONTROL_PLANE_UNAVAILABLE",
        message: "Control-plane actions are unavailable until this deployment is fully configured.",
      };
}
