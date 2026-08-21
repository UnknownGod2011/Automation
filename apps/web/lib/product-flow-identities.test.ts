import { describe, expect, it } from "vitest";
import { freshTestRunId, workflowIdForAutomation } from "./product-flow-identities";

describe("product-flow server-owned identities", () => {
  it("uses the authenticated automation identity as the stable workflow identity", () => {
    expect(workflowIdForAutomation(" automation-123 ")).toBe("automation-123");
    expect(() => workflowIdForAutomation("   ")).toThrow(/automationId/);
  });

  it("generates bounded fresh-test run identities without accepting user-supplied ids", () => {
    expect(freshTestRunId(() => "123e4567-e89b-12d3-a456-426614174000")).toBe(
      "test-123e4567-e89b-12d3-a456-426614174000",
    );
    expect(() => freshTestRunId(() => "contains spaces")).toThrow(/identity/);
  });
});
