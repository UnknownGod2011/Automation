import { describe, expect, it } from "vitest";
import { newAutomationAccess } from "./new-automation-access";

describe("new automation access", () => {
  it("renders the create form only for an authenticated product session", () => {
    expect(newAutomationAccess({ kind: "AUTHENTICATED" })).toEqual({ kind: "READY" });
  });

  it("requires sign-in before a signed-out visitor can enter automation metadata", () => {
    expect(newAutomationAccess({ kind: "SIGNED_OUT" })).toEqual({ kind: "SIGN_IN_REQUIRED" });
  });

  it("shows explicit deployment configuration state instead of a writable-looking form", () => {
    expect(newAutomationAccess({ kind: "NOT_CONFIGURED" })).toEqual({ kind: "NOT_CONFIGURED" });
  });
});
