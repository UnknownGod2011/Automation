import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import type { WorkflowNode } from "@automation/contracts";
import {
  AgentCorePlaywrightBrowserExecutor,
  AgentCorePlaywrightVerificationEngine,
} from "./index.js";
import { captureSafePageStateFingerprint } from "./capture-verification-state.js";

class FakeLocator {
  clicks = 0;
  fills: string[] = [];

  constructor(
    readonly visible = true,
    readonly text = "value",
  ) {}

  first(): Locator {
    return this as unknown as Locator;
  }

  async isVisible() {
    return this.visible;
  }

  async click() {
    this.clicks += 1;
  }

  async fill(value: string) {
    this.fills.push(value);
  }

  async inputValue() {
    return this.fills.at(-1) ?? this.text;
  }

  async textContent() {
    return this.text;
  }
}

class FakePage {
  currentUrl = "https://example.com/start";
  titleValue = "Example";
  gotoCalls: string[] = [];
  waits: number[] = [];
  screenshotCalls = 0;
  gotoStatus = 200;
  structuralMarkers: unknown[] = [];
  roleLocators = new Map<string, FakeLocator>();
  textLocators = new Map<string, FakeLocator>();
  testIdLocators = new Map<string, FakeLocator>();
  selectorLocators = new Map<string, FakeLocator>();

  url() {
    return this.currentUrl;
  }

  async title() {
    return this.titleValue;
  }

  async evaluate() {
    return structuredClone(this.structuralMarkers);
  }

  async goto(url: string) {
    this.gotoCalls.push(url);
    this.currentUrl = url;
    return { status: () => this.gotoStatus };
  }

  getByRole(role: string, options?: { name?: string }) {
    const key = `${role}:${options?.name ?? ""}`;
    return (this.roleLocators.get(key) ?? new FakeLocator(false)) as unknown as Locator;
  }

  getByText(text: string) {
    return (this.textLocators.get(text) ?? new FakeLocator(false)) as unknown as Locator;
  }

  getByTestId(testId: string) {
    return (this.testIdLocators.get(testId) ?? new FakeLocator(false)) as unknown as Locator;
  }

  locator(selector: string) {
    return (this.selectorLocators.get(selector) ?? new FakeLocator(false)) as unknown as Locator;
  }

  async waitForTimeout(milliseconds: number) {
    this.waits.push(milliseconds);
  }

  async screenshot() {
    this.screenshotCalls += 1;
    return new Uint8Array([1, 2, 3]);
  }
}

class FakeEvidence {
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

const retryPolicy = {
  maxAttempts: 2,
  initialBackoffMs: 10,
  maxBackoffMs: 100,
  jitter: false,
  retryableFailureCodes: ["ELEMENT_NOT_FOUND"] as const,
};

function node(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    kind: "CLICK",
    objective: "Perform the action",
    deterministicStrategies: [],
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: [],
    retryPolicy,
    timeoutMs: 5_000,
    next: ["end"],
    escalation: "FAIL",
    ...overrides,
  };
}

function executor(page = new FakePage(), evidence = new FakeEvidence()) {
  return {
    page,
    evidence,
    value: new AgentCorePlaywrightBrowserExecutor(
      page as unknown as Page,
      evidence as never,
    ),
  };
}

const scope = { tenantId: "tenant-1", userId: "user-1" };

describe("AgentCorePlaywrightBrowserExecutor", () => {
  it("resolves a deterministic locator before dispatching exactly one click", async () => {
    const { page, value } = executor();
    const hidden = new FakeLocator(false);
    const visible = new FakeLocator(true);
    page.roleLocators.set("button:Open report", hidden);
    page.textLocators.set("Open report", visible);

    const result = await value.executeDeterministic(
      scope,
      "run-1",
      node({
        deterministicStrategies: [
          { kind: "ROLE", value: "button:Open report" },
          { kind: "TEXT", value: "Open report" },
        ],
      }),
      {},
    );

    expect(result.failure).toBeUndefined();
    expect(hidden.clicks).toBe(0);
    expect(visible.clicks).toBe(1);
  });

  it("never falls through to a second locator after a click dispatch", async () => {
    const { page, value } = executor();
    const first = new FakeLocator(true);
    const second = new FakeLocator(true);
    page.roleLocators.set("button:Submit", first);
    page.textLocators.set("Submit", second);

    await value.executeDeterministic(
      scope,
      "run-1",
      node({
        deterministicStrategies: [
          { kind: "ROLE", value: "button:Submit" },
          { kind: "TEXT", value: "Submit" },
        ],
      }),
      {},
    );

    expect(first.clicks).toBe(1);
    expect(second.clicks).toBe(0);
  });

  it("does not persist a post-input screenshot for TYPE nodes", async () => {
    const { page, evidence, value } = executor();
    const input = new FakeLocator(true);
    page.selectorLocators.set("#secret", input);

    const result = await value.executeDeterministic(
      scope,
      "run-1",
      node({
        kind: "TYPE",
        deterministicStrategies: [{ kind: "CSS", value: "#secret" }],
      }),
      { value: "private-value" },
    );

    expect(result.failure).toBeUndefined();
    expect(input.fills).toEqual(["private-value"]);
    expect(evidence.calls.at(-1)).toEqual({
      kind: "type",
      includeScreenshot: false,
    });
  });

  it("blocks non-HTTP navigation before Playwright receives it", async () => {
    const { page, value } = executor();
    const result = await value.executeDeterministic(
      scope,
      "run-1",
      node({
        kind: "NAVIGATE",
        deterministicStrategies: [{ kind: "URL", value: "javascript:alert(1)" }],
      }),
      {},
    );

    expect(result.failure?.code).toBe("POLICY_BLOCKED");
    expect(page.gotoCalls).toEqual([]);
  });

  it("classifies HTTP 401 navigation as target authentication required", async () => {
    const { page, value } = executor();
    page.gotoStatus = 401;
    const result = await value.executeDeterministic(
      scope,
      "run-1",
      node({
        kind: "NAVIGATE",
        deterministicStrategies: [{ kind: "URL", value: "https://example.com/private" }],
      }),
      {},
    );

    expect(result.failure?.code).toBe("TARGET_AUTH_REQUIRED");
  });

  it("fails unsupported control-flow nodes explicitly instead of guessing semantics", async () => {
    const { value } = executor();
    const result = await value.executeDeterministic(
      scope,
      "run-1",
      node({ kind: "CONDITION" }),
      {},
    );

    expect(result.failure).toMatchObject({
      code: "NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("executes only constrained semantic browser primitives", async () => {
    const { page, value } = executor();
    const target = new FakeLocator(true);
    page.selectorLocators.set("#safe-target", target);

    const result = await value.executeSemantic(
      scope,
      "run-1",
      node({ kind: "REASON" }),
      {
        summary: "Click the constrained target",
        action: "CLICK",
        arguments: { selector: "#safe-target" },
        confidence: 0.9,
      },
      {},
    );

    expect(result.failure).toBeUndefined();
    expect(target.clicks).toBe(1);

    const blocked = await value.executeSemantic(
      scope,
      "run-1",
      node({ kind: "REASON" }),
      {
        summary: "Do not execute arbitrary code",
        action: "EVALUATE_JS",
        arguments: { code: "fetch('/secret')" },
        confidence: 0.9,
      },
      {},
    );
    expect(blocked.failure?.code).toBe("POLICY_BLOCKED");
  });
});

describe("AgentCorePlaywrightVerificationEngine", () => {
  it("verifies URL, text, and DOM state deterministically", async () => {
    const page = new FakePage();
    const evidence = new FakeEvidence();
    page.currentUrl = "https://example.com/report/42";
    page.textLocators.set("Completed", new FakeLocator(true));
    page.selectorLocators.set("[data-state=done]", new FakeLocator(true));
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );
    const verificationNode = node({ kind: "VERIFY" });

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: verificationNode,
        verification: {
          description: "report URL",
          mode: "URL",
          expected: "/report/42",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({ verified: true });

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: verificationNode,
        verification: {
          description: "completed text",
          mode: "TEXT",
          expected: "Completed",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({ verified: true });

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: verificationNode,
        verification: {
          description: "done marker",
          mode: "DOM",
          expected: "[data-state=done]",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({ verified: true });
  });

  it("verifies capture-generated input state without persisting a screenshot", async () => {
    const page = new FakePage();
    const evidence = new FakeEvidence();
    const input = new FakeLocator(true, "runtime-secret-value");
    page.testIdLocators.set("note", input);
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      evidence as never,
    );

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: node({ kind: "TYPE", deterministicStrategies: [{ kind: "TEST_ID", value: "note" }] }),
        verification: {
          description: "input was populated",
          mode: "CUSTOM",
          expected: "capture:input-filled",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(evidence.calls.at(-1)).toEqual({ kind: "verify-passed", includeScreenshot: false });
  });

  it("verifies capture-generated structural state using only the redacted digest", async () => {
    const page = new FakePage();
    page.currentUrl = "https://example.com/app?private=query#token";
    page.structuralMarkers = [
      { tag: "button", testId: "save", ariaDisabled: "true" },
      { tag: "form", id: "editor" },
    ];
    const expected = await captureSafePageStateFingerprint(page as unknown as Page);
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      new FakeEvidence() as never,
    );

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: node({ kind: "CLICK" }),
        verification: {
          description: "captured post-action state",
          mode: "CUSTOM",
          expected,
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(expected).toMatch(/^capture:state:[0-9a-f]+$/);
    expect(expected).not.toContain("private=query");
  });

  it("rejects unknown CUSTOM verification rather than guessing semantics", async () => {
    const page = new FakePage();
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      new FakeEvidence() as never,
    );

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: node({ kind: "VERIFY" }),
        verification: {
          description: "unsupported custom check",
          mode: "CUSTOM",
          expected: "vendor:unknown",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).rejects.toMatchObject({
      failure: { code: "NOT_CONFIGURED" },
    });
  });

  it("requires an explicit adapter for model verification", async () => {
    const page = new FakePage();
    const verifier = new AgentCorePlaywrightVerificationEngine(
      page as unknown as Page,
      new FakeEvidence() as never,
    );

    await expect(
      verifier.verify({
        scope,
        runId: "run-1",
        node: node({ kind: "VERIFY" }),
        verification: {
          description: "model-based check",
          mode: "MODEL",
          timeoutMs: 1_000,
        },
        outputs: {},
        evidenceRefs: [],
      }),
    ).rejects.toMatchObject({
      failure: { code: "NOT_CONFIGURED" },
    });
  });
});
