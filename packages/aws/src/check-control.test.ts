import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import {
  AgentCorePlaywrightBrowserExecutor,
  AgentCorePlaywrightVerificationEngine,
} from "./playwright-runtime.js";

class CheckboxLocator {
  checked = false;
  checkCalls = 0;
  uncheckCalls = 0;

  first(): Locator {
    return this as unknown as Locator;
  }

  async isVisible() {
    return true;
  }

  async check() {
    this.checkCalls += 1;
    this.checked = true;
  }

  async uncheck() {
    this.uncheckCalls += 1;
    this.checked = false;
  }

  async isChecked() {
    return this.checked;
  }
}

class CheckboxPage {
  readonly target = new CheckboxLocator();

  url() {
    return "https://example.com/form";
  }

  async title() {
    return "Example form";
  }

  getByTestId(testId: string) {
    return testId === "include-archived"
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
const checkNode: WorkflowNode = {
  id: "check-archived",
  kind: "CHECK",
  objective: "Set the captured checkbox state",
  deterministicStrategies: [{ kind: "TEST_ID", value: "include-archived", confidence: 1 }],
  inputBindings: { checked: "capture.check.checked" },
  outputBindings: {},
  allowedSideEffects: ["CHECK"],
  verification: {
    description: "Checkbox state matches the demonstrated state",
    mode: "CUSTOM",
    expected: "capture:check-bound-state",
    timeoutMs: 5_000,
  },
  retryPolicy: {
    maxAttempts: 3,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
    jitter: false,
    retryableFailureCodes: ["ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"],
  },
  timeoutMs: 5_000,
  next: ["end"],
  escalation: "HUMAN",
};

describe("captured CHECK runtime primitive", () => {
  it("idempotently checks the target and keeps evidence metadata-only", async () => {
    const page = new CheckboxPage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    );

    const first = await executor.executeDeterministic(scope, "run-1", checkNode, { checked: true });
    const replay = await executor.executeDeterministic(scope, "run-1", checkNode, { checked: true });

    expect(first.failure).toBeUndefined();
    expect(replay.failure).toBeUndefined();
    expect(first.outputs).toEqual({ checked: true });
    expect(page.target.checked).toBe(true);
    expect(page.target.checkCalls).toBe(2);
    expect(page.target.uncheckCalls).toBe(0);
    expect(evidence.calls).toEqual([
      { kind: "check", includeScreenshot: false },
      { kind: "check", includeScreenshot: false },
    ]);
  });

  it("idempotently unchecks the target", async () => {
    const page = new CheckboxPage();
    page.target.checked = true;
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      new Evidence() as never,
    );

    const result = await executor.executeDeterministic(scope, "run-1", checkNode, { checked: false });
    expect(result.failure).toBeUndefined();
    expect(result.outputs).toEqual({ checked: false });
    expect(page.target.checked).toBe(false);
    expect(page.target.uncheckCalls).toBe(1);
  });

  it("verifies the actual checkbox state without a screenshot", async () => {
    const page = new CheckboxPage();
    const evidence = new Evidence();
    page.target.checked = true;
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    const verified = await verifier.verify({
      scope,
      runId: "run-1",
      node: checkNode,
      verification: checkNode.verification!,
      outputs: { checked: true },
      evidenceRefs: [],
    });
    expect(verified.verified).toBe(true);
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-passed", includeScreenshot: false });

    page.target.checked = false;
    const mismatch = await verifier.verify({
      scope,
      runId: "run-1",
      node: checkNode,
      verification: checkNode.verification!,
      outputs: { checked: true },
      evidenceRefs: [],
    });
    expect(mismatch.verified).toBe(false);
  });

  it("fails before browser mutation when the bound state is not boolean", async () => {
    const page = new CheckboxPage();
    const executor = new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      new Evidence() as never,
    );
    const result = await executor.executeDeterministic(scope, "run-1", checkNode, { checked: "yes" });
    expect(result.failure?.code).toBe("POLICY_BLOCKED");
    expect(page.target.checkCalls).toBe(0);
    expect(page.target.uncheckCalls).toBe(0);
  });
});