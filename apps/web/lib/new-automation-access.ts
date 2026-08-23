import type { WebControlPlaneConfig } from "./control-plane-client";
import { readWebControlPlaneConfig, WebControlPlaneClient } from "./control-plane-client";
import type { WebAuthStatus } from "./server-auth";

export type NewAutomationAccess =
  | { kind: "READY" }
  | { kind: "SIGN_IN_REQUIRED" }
  | { kind: "AUTH_NOT_CONFIGURED" }
  | { kind: "CONTROL_PLANE_NOT_CONFIGURED" };

/**
 * Presentation-only gate for the create-automation page.
 * Mutation authorization remains enforced by the authenticated server/API boundary.
 *
 * The synthetic bearer value is used only to exercise the existing control-plane URL
 * validation through `status()`. No request is made from this helper.
 */
export function newAutomationAccess(
  auth: WebAuthStatus,
  controlPlaneConfig: WebControlPlaneConfig = readWebControlPlaneConfig(),
): NewAutomationAccess {
  switch (auth.kind) {
    case "NOT_CONFIGURED":
      return { kind: "AUTH_NOT_CONFIGURED" };
    case "SIGNED_OUT":
      return { kind: "SIGN_IN_REQUIRED" };
    case "AUTHENTICATED": {
      const status = new WebControlPlaneClient({
        ...controlPlaneConfig,
        bearerToken: "presentation-readiness-only",
      }).status();
      return status.configured ? { kind: "READY" } : { kind: "CONTROL_PLANE_NOT_CONFIGURED" };
    }
  }
}
