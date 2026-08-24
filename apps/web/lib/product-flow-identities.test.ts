import { describe, expect, it } from "vitest";
import {
  freshTestRunId,
  serverResolvedPublishWorkflowVersion,
  workflowIdForAutomation,
} from "./product-flow-identities";

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

  it("resolves publish version only from durable successful fresh-test runs when the automation is ready", () => {
    expect(
      serverResolvedPublishWorkflowVersion(
        { status: "READY_TO_PUBLISH" },
        [
          { status: "SUCCEEDED", workflowVersion: 1, runKind: "FRESH_TEST" },
          { status: "FAILED", workflowVersion: 4, runKind: "FRESH_TEST" },
          { status: "SUCCEEDED", workflowVersion: 99, runKind: "SCHEDULED" },
          { status: "SUCCEEDED", workflowVersion: 98 },
          { status: "SUCCEEDED", workflowVersion: 2, runKind: "FRESH_TEST" },
        ],
      ),
    ).toBe(2);

    expect(
      serverResolvedPublishWorkflowVersion(
        { status: "READY_TO_TEST" },
        [{ status: "SUCCEEDED", workflowVersion: 2, runKind: "FRESH_TEST" }],
      ),
    ).toBeNull();
    expect(
      serverResolvedPublishWorkflowVersion(
        { status: "READY_TO_PUBLISH" },
        [{ status: "FAILED", workflowVersion: 2, runKind: "FRESH_TEST" }],
      ),
    ).toBeNull();
  });

  it("fails closed when READY_TO_PUBLISH has only scheduled or unclassified successful runs", () => {
    expect(
      serverResolvedPublishWorkflowVersion(
        { status: "READY_TO_PUBLISH" },
        [
          { status: "SUCCEEDED", workflowVersion: 7, runKind: "SCHEDULED" },
          { status: "SUCCEEDED", workflowVersion: 8 },
        ],
      ),
    ).toBeNull();
  });
});
