export type DashboardCreateAutomationPresentation =
  | { kind: "READY"; label: "Create automation" }
  | { kind: "BLOCKED"; label: "Creation unavailable"; message: string };

/**
 * Presentation-only dashboard gate for automation creation.
 * Mutation authorization remains enforced by the authenticated control-plane boundary.
 */
export function dashboardCreateAutomationPresentation(
  controlPlaneConfigured: boolean,
): DashboardCreateAutomationPresentation {
  return controlPlaneConfigured
    ? { kind: "READY", label: "Create automation" }
    : {
        kind: "BLOCKED",
        label: "Creation unavailable",
        message: "Connect the authenticated control plane before creating an automation.",
      };
}
