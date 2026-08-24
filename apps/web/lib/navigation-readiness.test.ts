import { describe, expect, it } from "vitest";
import { authenticatedNavigationPresentation } from "./navigation-readiness";

describe("authenticated navigation readiness", () => {
  it("shows control-plane actions only when the deployment is ready", () => {
    expect(authenticatedNavigationPresentation({ kind: "READY" })).toEqual({ kind: "READY" });
  });

  it("suppresses control-plane actions when the authenticated deployment is incomplete", () => {
    expect(authenticatedNavigationPresentation({ kind: "CONTROL_PLANE_NOT_CONFIGURED" })).toEqual({
      kind: "CONTROL_PLANE_UNAVAILABLE",
      message: "Control-plane actions are unavailable until this deployment is fully configured.",
    });
  });
});
