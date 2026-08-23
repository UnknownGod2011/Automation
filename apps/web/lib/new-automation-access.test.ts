import { describe, expect, it } from "vitest";
import { newAutomationAccess } from "./new-automation-access";

describe("new automation access", () => {
  it("renders the create form only when auth and the control-plane endpoint are configured", () => {
    expect(newAutomationAccess(
      { kind: "AUTHENTICATED" },
      { baseUrl: "https://control.example.test" },
    )).toEqual({ kind: "READY" });
  });

  it("requires sign-in before a signed-out visitor can enter automation metadata", () => {
    expect(newAutomationAccess(
      { kind: "SIGNED_OUT" },
      { baseUrl: "https://control.example.test" },
    )).toEqual({ kind: "SIGN_IN_REQUIRED" });
  });

  it("distinguishes missing authentication configuration from control-plane deployment state", () => {
    expect(newAutomationAccess(
      { kind: "NOT_CONFIGURED" },
      { baseUrl: "https://control.example.test" },
    )).toEqual({ kind: "AUTH_NOT_CONFIGURED" });
    expect(newAutomationAccess({ kind: "AUTHENTICATED" }, {})).toEqual({
      kind: "CONTROL_PLANE_NOT_CONFIGURED",
    });
  });

  it("rejects an unsafe remote control-plane URL before showing the authoring form", () => {
    expect(newAutomationAccess(
      { kind: "AUTHENTICATED" },
      { baseUrl: "http://control.example.test" },
    )).toEqual({ kind: "CONTROL_PLANE_NOT_CONFIGURED" });
  });
});
