import { describe, expect, it } from "vitest";
import { dashboardCreateAutomationPresentation } from "./dashboard-create";

describe("dashboard create automation presentation", () => {
  it("offers automation creation only when the authenticated control plane is configured", () => {
    expect(dashboardCreateAutomationPresentation(true)).toEqual({
      kind: "READY",
      label: "Create automation",
    });
  });

  it("renders an explicit non-writable state when the control plane is unavailable", () => {
    expect(dashboardCreateAutomationPresentation(false)).toEqual({
      kind: "BLOCKED",
      label: "Creation unavailable",
      message: "Connect the authenticated control plane before creating an automation.",
    });
  });
});
