import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@automation/contracts";
import type { ArtifactStore, HumanResumeEffectInspectionContext } from "@automation/core";
import {
  AgentCorePlaywrightHumanResumeEffectVerifier,
  type PlaywrightReconciliationObservationPage,
} from "./human-resume-reconciliation-verifier.js";

class FakeLocator {
  constructor(
    private readonly visible: boolean,
    private readonly error?: Error,
  ) {}

  first() {
    return this;
  }

  async isVisible() {
    if (this.error) throw this.error;
    return this.visible;
  }
}

class FakeObservationPage implements PlaywrightReconciliationObservationPage {
  currentUrl = "https://example.com/start";
  titleValue = "Example";
  text = new Map<string, FakeLocator>();
  selectors = new Map<string, FakeLocator>();
  actionCalls = 0;

  url() {
    return this.currentUrl;
  }

  async title() {
    return this.titleValue;
  }

  getByText(text: string) {
    return this.text.get(text) ?? new FakeLocator(false);
  }

  locator(selector: string) {
    return this.selectors.get(selector) ?? new FakeLocator(false);
  }

  async click() {
    this.actionCalls += 1;
  }
}

class FakeArtifacts {
  puts: Array<{ scope: unknown; path: string; text: string; contentType: string }> = [];
  fail = false;

  async put(scope: unknown, path: string, content: Uint8Array, contentType: string) {
    if (this.fail) throw new Error("storage unavailable secret=do-not-leak");
    this.puts.push({
      scope,
      path,
      text: new TextDecoder().decode(content),
      contentType,
    });
    return { ref: `artifact://${path}`, contentType, sizeBytes: content.byteLength };
  }

  async get() {
    return null;
  }
}

const retryPolicy = {
  maxAttempts: 1,
  initialBackoffMs: 0,
  maxBackoffMs: 0,
  jitter: false,
  retryableFailureCodes: [] as const,
};

function node(): WorkflowNode {
  return {
    id: "successor",
    kind: "CLICK",
    objective: "Submit once",
    deterministicStrategies: [{ kind: "TEXT", value: "Submit" }],
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: ["submit-form"],
    verification: {
      description: "success marker",
      mode: "TEXT",
      expected: "Completed",
      timeoutMs: 1_000,
    },
    retryPolicy,
    timeoutMs: 5_000,
    next: ["end"],
    escalation: "HUMAN",
  };
}

function context(overrides: Partial<HumanResumeEffectInspectionContext> = {}): HumanResumeEffectInspectionContext {
  const workflowNode = node();
  return {
    scope: { tenantId: "tenant-1", userId: "user-1" },
    runId: "run-1",
    humanNodeId: "human-1",
    resolutionId: "resolution-1",
    effectId: "effect-1",
    node: workflowNode,
    verification: workflowNode.verification!,
    ...overrides,
  };
}

function verifier(page = new FakeObservationPage(), artifacts = new FakeArtifacts()) {
  return {
    page,
    artifacts,
    value: new AgentCorePlaywrightHumanResumeEffectVerifier(
      page,
      artifacts as unknown as ArtifactStore,
    ),
  };
}

describe("AgentCorePlaywrightHumanResumeEffectVerifier", () => {
  it("returns ALREADY_APPLIED only when positive URL/TEXT/DOM evidence is observed", async () => {
    const { page, value } = verifier();
    page.currentUrl = "https://example.com/completed/42";
    page.text.set("Completed", new FakeLocator(true));
    page.selectors.set("[data-state=done]", new FakeLocator(true));

    await expect(value.inspect(context({ verification: {
      description: "url",
      mode: "URL",
      expected: "/completed/42",
      timeoutMs: 1_000,
    } }))).resolves.toMatchObject({ decision: "ALREADY_APPLIED" });

    await expect(value.inspect(context())).resolves.toMatchObject({ decision: "ALREADY_APPLIED" });

    await expect(value.inspect(context({ verification: {
      description: "dom",
      mode: "DOM",
      expected: "[data-state=done]",
      timeoutMs: 1_000,
    } }))).resolves.toMatchObject({ decision: "ALREADY_APPLIED" });

    expect(page.actionCalls).toBe(0);
  });

  it("keeps negative positive-state observations AMBIGUOUS instead of granting retry permission", async () => {
    const { value } = verifier();

    await expect(value.inspect(context())).resolves.toMatchObject({ decision: "AMBIGUOUS" });
    await expect(value.inspect(context({ verification: {
      description: "url",
      mode: "URL",
      expected: "/completed",
      timeoutMs: 1_000,
    } }))).resolves.toMatchObject({ decision: "AMBIGUOUS" });
    await expect(value.inspect(context({ verification: {
      description: "dom",
      mode: "DOM",
      expected: "[data-state=done]",
      timeoutMs: 1_000,
    } }))).resolves.toMatchObject({ decision: "AMBIGUOUS" });
  });

  it("writes metadata-only scoped evidence without expected text or screenshots", async () => {
    const { page, artifacts, value } = verifier();
    page.text.set("Completed", new FakeLocator(true));

    const result = await value.inspect(context());

    expect(result.evidenceRefs).toHaveLength(1);
    expect(artifacts.puts).toHaveLength(1);
    expect(artifacts.puts[0]?.scope).toEqual({ tenantId: "tenant-1", userId: "user-1" });
    expect(artifacts.puts[0]?.contentType).toBe("application/json");
    expect(artifacts.puts[0]?.text).toContain('"decision":"ALREADY_APPLIED"');
    expect(artifacts.puts[0]?.text).not.toContain("Completed");
    expect(artifacts.puts[0]?.path).toContain("/reconciliation/");
  });

  it("rejects MODEL/CUSTOM and missing expected values without guessing a decision", async () => {
    const { value } = verifier();

    await expect(value.inspect(context({ verification: {
      description: "model",
      mode: "MODEL",
      timeoutMs: 1_000,
    } }))).rejects.toMatchObject({ failure: { code: "NOT_CONFIGURED", retryable: false } });

    await expect(value.inspect(context({ verification: {
      description: "text",
      mode: "TEXT",
      timeoutMs: 1_000,
    } }))).rejects.toMatchObject({ failure: { code: "NOT_CONFIGURED", retryable: false } });
  });

  it("propagates observation uncertainty and evidence-storage failure without returning a decision", async () => {
    const page = new FakeObservationPage();
    page.text.set("Completed", new FakeLocator(false, Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    const artifacts = new FakeArtifacts();
    const value = new AgentCorePlaywrightHumanResumeEffectVerifier(
      page,
      artifacts as unknown as ArtifactStore,
    );

    await expect(value.inspect(context())).rejects.toMatchObject({
      failure: { code: "TRANSIENT_NETWORK", retryable: true },
    });
    expect(artifacts.puts).toHaveLength(0);

    page.text.set("Completed", new FakeLocator(true));
    artifacts.fail = true;
    await expect(value.inspect(context())).rejects.toMatchObject({
      failure: { code: "UNKNOWN", retryable: false, message: "reconciliation evidence persistence failed" },
    });
  });
});
