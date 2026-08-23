import type { WebAuthStatus } from "./server-auth";

export type NewAutomationAccess =
  | { kind: "READY" }
  | { kind: "SIGN_IN_REQUIRED" }
  | { kind: "NOT_CONFIGURED" };

/**
 * Presentation-only gate for the create-automation page.
 * Mutation authorization remains enforced by the authenticated server/API boundary.
 */
export function newAutomationAccess(auth: WebAuthStatus): NewAutomationAccess {
  switch (auth.kind) {
    case "AUTHENTICATED":
      return { kind: "READY" };
    case "SIGNED_OUT":
      return { kind: "SIGN_IN_REQUIRED" };
    case "NOT_CONFIGURED":
      return { kind: "NOT_CONFIGURED" };
  }
}
