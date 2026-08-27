import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import {
  AgentCorePlaywrightBrowserExecutor,
  AgentCorePlaywrightVerificationEngine,
} from "./playwright-runtime.js";

class TypeLocator {
  value = "";
  readonly fillCalls: string[] = [];

  constructor(private readonly transform: (value: string) => string = (value) => value) {}

  first(): Locator {
    return this as unknown as Locator;
  }

  async isVisible() {
    return true;
  }

  async fill(value: string) {
    this.fillCalls.push(value);
    this.value = this.transform(value);
  }

  async inputValue() {
    return this.value;
  }
}

class TypePage {
  readonly target: TypeLocator;

  constructor(transform?: (value: string) => string) {
    this.target = new TypeLocator(transform);
  }

  url() {
    return "https://example.com/form";
  }

  async title() {
    return "Example form";
  }

  getByTestId(testId: string) {
    return testId === "note"
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
const typeNode: WorkflowNode = {
  id: "type-note",
  kind: "TYPE",
  objective: "Enter text in captured textbox",
  deterministicStrategies: [{ kind: "TEST_ID", value: "note", confidence: 1 }],
  inputBindings: { value: "capture_input_1" },
  outputBindings: {},
  allowedSideEffects: ["TYPE"],
  verification: {
    description: "Captured input target remains populated after typing",
    mode: "CUSTOM",
    expected: "capture:input-filled",
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
  escalation: "SEMANTIC_RECOVERY",
};

describe("captured TYPE bound-value verification", () => {
  it("returns the bound value only as a transient action output and suppresses screenshots", async () => {
    const page = new TypePage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const result = await executor.executeDeterministic(
      scope,
      "run-1",
      typeNode,
      { value: "private per-run note" },
    );

    expect(result.failure).toBeUndefined();
    expect(page.target.fillCalls).toEqual(["private per-run note"]);
    expect(result.outputs).toEqual({ typedValue: "private per-run note" });
    expect(evidence.calls).toEqual([{ kind: "type", includeScreenshot: false }]);
  });

  it("verifies the browser value exactly instead of accepting any non-empty value", async () => {
    const page = new TypePage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    const action = await executor.executeDeterministic(
      scope,
      "run-1",
      typeNode,
      { value: "expected note" },
    );
    const verified = await verifier.verify({
      scope,
      runId: "run-1",
      node: typeNode,
      verification: typeNode.verification!,
      outputs: action.outputs,
      evidenceRefs: action.evidenceRefs,
    });
    expect(verified.verified).toBe(true);
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-passed", includeScreenshot: false });

    page.target.value = "different non-empty note";
    const mismatch = await verifier.verify({
      scope,
      runId: "run-1",
      node: typeNode,
      verification: typeNode.verification!,
      outputs: action.outputs,
      evidenceRefs: action.evidenceRefs,
    });
    expect(mismatch.verified).toBe(false);
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-failed", includeScreenshot: false });
  });

  it("accepts an intentionally empty bound value only when the browser is also empty", async () => {
    const page = new TypePage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    const action = await executor.executeDeterministic(scope, "run-1", typeNode, { value: "" });
    const result = await verifier.verify({
      scope,
      runId: "run-1",
      node: typeNode,
      verification: typeNode.verification!,
      outputs: action.outputs,
      evidenceRefs: action.evidenceRefs,
    });
    expect(result.verified).toBe(true);
  });

  it("fails closed for TYPE verification when the transient bound value is missing", async () => {
    const page = new TypePage();
    page.target.value = "some non-empty value";
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      new Evidence() as never,
    );

    const result = await verifier.verify({
      scope,
      runId: "run-1",
      node: typeNode,
      verification: typeNode.verification!,
      outputs: {},
      evidenceRefs: [],
    });
    expect(result.verified).toBe(false);
    expect(result.detail).toContain("no transient bound value");
  });

  it("preserves the transient typed value through constrained semantic TYPE fallback", async () => {
    const page = new TypePage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const result = await executor.executeSemantic(
      scope,
      "run-1",
      typeNode,
      {
        summary: "Use the captured note field",
        action: "TYPE",
        arguments: { testId: "note", value: "semantic note" },
        confidence: 0.9,
      },
      { value: "semantic note" },
    );

    expect(result.failure).toBeUndefined();
    expect(result.outputs).toEqual({ typedValue: "semantic note" });
    expect(page.target.fillCalls).toEqual(["semantic note"]);
    expect(evidence.calls).toEqual([{ kind: "semantic-type", includeScreenshot: false }]);
  });

  it("detects a browser transformation instead of treating the field as merely populated", async () => {
    const page = new TypePage((value) => value.toUpperCase());
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    const action = await executor.executeDeterministic(
      scope,
      "run-1",
      typeNode,
      { value: "Case-sensitive note" },
    );
    const result = await verifier.verify({
      scope,
      runId: "run-1",
      node: typeNode,
      verification: typeNode.verification!,
      outputs: action.outputs,
      evidenceRefs: action.evidenceRefs,
    });
    expect(result.verified).toBe(false);
  });
});
