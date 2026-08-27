import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import {
  AgentCorePlaywrightBrowserExecutor,
  AgentCorePlaywrightVerificationEngine,
} from "./playwright-runtime.js";

class RadioLocator {
  checked = false;
  checkCalls = 0;

  first(): Locator { return this as unknown as Locator; }
  async isVisible() { return true; }
  async check() { this.checkCalls += 1; this.checked = true; }
  async uncheck() { throw new Error("radio option must never be unchecked by compiled intent"); }
  async isChecked() { return this.checked; }
}

class RadioPage {
  readonly target = new RadioLocator();
  url() { return "https://example.com/preferences"; }
  async title() { return "Preferences"; }
  getByTestId(testId: string) {
    return testId === "delivery-email"
      ? this.target as unknown as Locator
      : ({ first: () => ({ isVisible: async () => false }) } as unknown as Locator);
  }
}

class Evidence {
  readonly calls: { kind: string; includeScreenshot: boolean }[] = [];
  async record(_page: Page, _node: WorkflowNode, kind: string, includeScreenshot: boolean) {
    this.calls.push({ kind, includeScreenshot });
    return { evidenceRefs: [`evidence://${kind}`], stateFingerprint: `fingerprint:${kind}` };
  }
}

const scope = { tenantId: "tenant-1", userId: "user-1" };
const radioNode: WorkflowNode = {
  id: "radio-email",
  kind: "CHECK",
  objective: "Select captured radio option for event delivery-email",
  deterministicStrategies: [{ kind: "TEST_ID", value: "delivery-email", confidence: 1 }],
  inputBindings: { checked: "capture.delivery-email.checked" },
  outputBindings: {},
  allowedSideEffects: ["CHECK"],
  verification: {
    description: "Captured radio option remains selected",
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

describe("captured radio checked-state execution", () => {
  it("idempotently selects the captured radio target with metadata-only evidence", async () => {
    const page = new RadioPage();
    const evidence = new Evidence();
    const executor = new AgentCorePlaywrightBrowserExecutor(page as unknown as Page, evidence as never);

    const first = await executor.executeDeterministic(scope, "run-1", radioNode, { checked: true });
    const replay = await executor.executeDeterministic(scope, "run-1", radioNode, { checked: true });

    expect(first.failure).toBeUndefined();
    expect(replay.failure).toBeUndefined();
    expect(first.outputs).toEqual({ checked: true });
    expect(page.target.checked).toBe(true);
    expect(page.target.checkCalls).toBe(2);
    expect(evidence.calls).toEqual([
      { kind: "check", includeScreenshot: false },
      { kind: "check", includeScreenshot: false },
    ]);
  });

  it("independently verifies the selected radio state without a screenshot", async () => {
    const page = new RadioPage();
    page.target.checked = true;
    const evidence = new Evidence();
    const verifier = new AgentCorePlaywrightVerificationEngine(page as unknown as Page, evidence as never);

    const result = await verifier.verify({
      scope,
      runId: "run-1",
      node: radioNode,
      verification: radioNode.verification!,
      outputs: { checked: true },
      evidenceRefs: [],
    });

    expect(result.verified).toBe(true);
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-passed", includeScreenshot: false });
  });
});
