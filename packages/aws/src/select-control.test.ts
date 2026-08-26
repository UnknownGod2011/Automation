import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import {
  AgentCorePlaywrightBrowserExecutor,
  AgentCorePlaywrightVerificationEngine,
} from "./playwright-runtime.js";

class SelectLocator {
  selectedValue = "";
  selectCalls: string[] = [];

  first(): Locator {
    return this as unknown as Locator;
  }

  async isVisible() {
    return true;
  }

  async selectOption(option: { label?: string }) {
    const label = option.label ?? "";
    this.selectCalls.push(label);
    this.selectedValue = label === "High priority" ? "high" : label;
    return [this.selectedValue];
  }

  async inputValue() {
    return this.selectedValue;
  }
}

class SelectPage {
  readonly target = new SelectLocator();

  url() {
    return "https://example.com/form";
  }

  async title() {
    return "Example form";
  }

  getByTestId(testId: string) {
    return testId === "priority"
      ? this.target as unknown as Locator
      : ({ first: () => ({ isVisible: async () => false }) } as unknown as Locator);
  }

  async screenshot() {
    return new Uint8Array([1]);
  }
}

class Evidence {
  readonly calls: { kind: string; includeScreenshot: boolean }[] = [];

  async record(
    _page: Page,
    _node: WorkflowNode,
    kind: string,
    includeScreenshot: boolean,
  ) {
    this.calls.push({ kind, includeScreenshot });
    return {
      evidenceRefs: [`evidence://${kind}`],
      stateFingerprint: `fingerprint:${kind}`,
    };
  }
}

const scope = { tenantId: "tenant-1", userId: "user-1" };
const selectNode: WorkflowNode = {
  id: "select-priority",
  kind: "SELECT",
  objective: "Select the captured priority",
  deterministicStrategies: [{ kind: "TEST_ID", value: "priority", confidence: 1 }],
  inputBindings: { value: "capture_input_1" },
  outputBindings: {},
  allowedSideEffects: ["SELECT"],
  verification: {
    description: "Selected option matches the bound runtime value",
    mode: "CUSTOM",
    expected: "capture:select-bound-value",
    timeoutMs: 5_000,
  },
  retryPolicy: {
    maxAttempts: 2,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
    jitter: false,
    retryableFailureCodes: ["ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"],
  },
  timeoutMs: 5_000,
  next: ["end"],
  escalation: "HUMAN",
};

describe("captured SELECT runtime primitive", () => {
  it("selects exactly one option by the bound label and suppresses screenshots", async () => {
    const page = new SelectPage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const result = await executor.executeDeterministic(
      scope,
      "run-1",
      selectNode,
      { value: "High priority" },
    );

    expect(result.failure).toBeUndefined();
    expect(page.target.selectCalls).toEqual(["High priority"]);
    expect(result.outputs).toEqual({ selectedValue: "high" });
    expect(evidence.calls).toEqual([{ kind: "select", includeScreenshot: false }]);
  });

  it("verifies the actual selected value without persisting a screenshot", async () => {
    const page = new SelectPage();
    const evidence = new Evidence();
    page.target.selectedValue = "high";
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    const verified = await verifier.verify({
      scope,
      runId: "run-1",
      node: selectNode,
      verification: selectNode.verification!,
      outputs: { selectedValue: "high" },
      evidenceRefs: [],
    });
    expect(verified.verified).toBe(true);
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-passed", includeScreenshot: false });

    page.target.selectedValue = "low";
    const mismatch = await verifier.verify({
      scope,
      runId: "run-1",
      node: selectNode,
      verification: selectNode.verification!,
      outputs: { selectedValue: "high" },
      evidenceRefs: [],
    });
    expect(mismatch.verified).toBe(false);
  });

  it("fails before browser mutation when no bound option label exists", async () => {
    const page = new SelectPage();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      new Evidence() as never,
    );
    const result = await executor.executeDeterministic(scope, "run-1", selectNode, {});
    expect(result.failure?.code).toBe("POLICY_BLOCKED");
    expect(page.target.selectCalls).toEqual([]);
  });
});
