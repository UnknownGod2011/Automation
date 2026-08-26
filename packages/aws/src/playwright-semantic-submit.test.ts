import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import { AgentCorePlaywrightBrowserExecutor } from "./index.js";

class FakeLocator {
  clicks = 0;

  first(): Locator {
    return this as unknown as Locator;
  }

  async isVisible() {
    return true;
  }

  async click() {
    this.clicks += 1;
  }
}

class FakePage {
  readonly target = new FakeLocator();

  url() {
    return "https://example.com/form";
  }

  async title() {
    return "Form";
  }

  getByTestId(testId: string) {
    return (testId === "submit-form" ? this.target : new FakeLocator()) as unknown as Locator;
  }

  getByRole() {
    return new FakeLocator() as unknown as Locator;
  }

  getByText() {
    return new FakeLocator() as unknown as Locator;
  }

  locator() {
    return new FakeLocator() as unknown as Locator;
  }

  async screenshot() {
    return new Uint8Array([1, 2, 3]);
  }
}

class FakeEvidence {
  calls: string[] = [];

  async record(
    _page: Page,
    _node: WorkflowNode,
    kind: string,
  ) {
    this.calls.push(kind);
    return {
      evidenceRefs: [`evidence://${kind}`],
      stateFingerprint: `fingerprint:${kind}`,
    };
  }
}

const submitNode: WorkflowNode = {
  id: "captured-submit",
  kind: "CLICK",
  objective: "Submit the captured form",
  deterministicStrategies: [{ kind: "TEST_ID", value: "submit-form" }],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: ["SUBMIT"],
  verification: {
    description: "submission effect is visible",
    mode: "CUSTOM",
    expected: "capture:state:abc123",
    timeoutMs: 5_000,
  },
  retryPolicy: {
    maxAttempts: 2,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
    jitter: false,
    retryableFailureCodes: ["ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"],
  },
  timeoutMs: 5_000,
  next: ["end"],
  escalation: "SEMANTIC_RECOVERY",
};

const scope = { tenantId: "tenant-1", userId: "user-1" };

describe("AgentCorePlaywrightBrowserExecutor semantic SUBMIT", () => {
  it("activates one constrained submit target exactly once", async () => {
    const page = new FakePage();
    const evidence = new FakeEvidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const result = await executor.executeSemantic(
      scope,
      "run-1",
      submitNode,
      {
        summary: "Use the moved submit button",
        action: "SUBMIT",
        arguments: { testId: "submit-form" },
        confidence: 0.9,
      },
      {},
    );

    expect(result.failure).toBeUndefined();
    expect(page.target.clicks).toBe(1);
    expect(evidence.calls).toEqual(["semantic-submit"]);
  });

  it("blocks generic CLICK before dispatch for submit-only authority", async () => {
    const page = new FakePage();
    const evidence = new FakeEvidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const result = await executor.executeSemantic(
      scope,
      "run-1",
      submitNode,
      {
        summary: "Try a generic click",
        action: "CLICK",
        arguments: { testId: "submit-form" },
        confidence: 0.9,
      },
      {},
    );

    expect(result.failure).toMatchObject({ code: "POLICY_BLOCKED", retryable: false });
    expect(page.target.clicks).toBe(0);
    expect(evidence.calls).toEqual([]);
  });
});
