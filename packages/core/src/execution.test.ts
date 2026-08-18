import { describe, expect, it } from "vitest";
import type {
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import {
  WorkflowExecutionEngine,
  planRetry,
  type BrowserActionResult,
  type BrowserExecutor,
  type CheckpointRepository,
  type OwnershipScope,
  type ReasoningDecision,
  type ReasoningProvider,
  type RunRepository,
  type VerificationContext,
  type VerificationEngine,
  type VerificationResult,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

const baseRetry = {
  maxAttempts: 3,
  initialBackoffMs: 100,
  maxBackoffMs: 1_000,
  jitter: false,
  retryableFailureCodes: ["ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"] as const,
};

const node = (overrides: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: "click",
  kind: "CLICK",
  objective: "Open the report",
  deterministicStrategies: [{ kind: "ROLE", value: "button:Open report" }],
  inputBindings: {},
  outputBindings: { value: "result" },
  allowedSideEffects: ["navigation"],
  verification: {
    description: "report is open",
    mode: "URL",
    expected: "/report",
    timeoutMs: 2_000,
  },
  retryPolicy: baseRetry,
  timeoutMs: 5_000,
  next: ["end"],
  escalation: "FAIL",
  ...overrides,
});

const graph = (entry: WorkflowNode): WorkflowGraph => ({
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: entry.id,
  objective: "Open a report",
  createdAt: "2026-08-18T00:00:00.000Z",
  nodes: {
    [entry.id]: entry,
    end: {
      id: "end",
      kind: "END",
      objective: "Finish",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        jitter: false,
        retryableFailureCodes: [],
      },
      timeoutMs: 1_000,
      escalation: "FAIL",
    },
  },
});

const run = (status: RunRecord["status"] = "RUNNING"): RunRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: "auto-1",
  workflowVersion: 1,
  occurrenceKey: "occurrence-1",
  status,
  scheduledAt: "2026-08-18T12:00:00.000Z",
  startedAt: "2026-08-18T12:00:00.000Z",
});

class MemoryRuns implements RunRepository {
  value: RunRecord;
  readonly updates: RunRecord[] = [];

  constructor(initial: RunRecord) {
    this.value = structuredClone(initial);
  }

  async createIfAbsent() {
    return { created: false as const, run: structuredClone(this.value) };
  }

  async get(_: OwnershipScope, runId: string) {
    return runId === this.value.runId ? structuredClone(this.value) : null;
  }

  async update(value: RunRecord) {
    this.value = structuredClone(value);
    this.updates.push(structuredClone(value));
  }

  async listForAutomation(_: OwnershipScope, automationId: string) {
    return this.value.automationId === automationId
      ? [structuredClone(this.value)]
      : [];
  }
}

class MemoryCheckpoints implements CheckpointRepository {
  value: RunCheckpoint | null;
  readonly writes: RunCheckpoint[] = [];

  constructor(initial: RunCheckpoint | null = null) {
    this.value = initial ? structuredClone(initial) : null;
  }

  async get(_: OwnershipScope, runId: string) {
    return this.value?.runId === runId ? structuredClone(this.value) : null;
  }

  async put(_: OwnershipScope, checkpoint: RunCheckpoint) {
    this.value = structuredClone(checkpoint);
    this.writes.push(structuredClone(checkpoint));
  }
}

class ScriptedBrowser implements BrowserExecutor {
  readonly deterministicCalls: Readonly<Record<string, unknown>>[] = [];
  readonly semanticCalls: ReasoningDecision[] = [];

  constructor(
    private readonly deterministic: BrowserActionResult[],
    private readonly semantic: BrowserActionResult[] = [],
  ) {}

  async executeDeterministic(
    _: OwnershipScope,
    __: string,
    ___: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
  ) {
    this.deterministicCalls.push(structuredClone(inputs));
    const result = this.deterministic.shift();
    if (!result) throw new Error("no deterministic result scripted");
    return structuredClone(result);
  }

  async executeSemantic(
    _: OwnershipScope,
    __: string,
    ___: WorkflowNode,
    decision: ReasoningDecision,
  ) {
    this.semanticCalls.push(structuredClone(decision));
    const result = this.semantic.shift();
    if (!result) throw new Error("no semantic result scripted");
    return structuredClone(result);
  }
}

class ScriptedReasoner implements ReasoningProvider {
  calls = 0;

  constructor(private readonly decisions: ReasoningDecision[]) {}

  async decide() {
    this.calls += 1;
    const decision = this.decisions.shift();
    if (!decision) throw new Error("no reasoning decision scripted");
    return structuredClone(decision);
  }
}

class ScriptedVerifier implements VerificationEngine {
  calls = 0;

  constructor(private readonly results: VerificationResult[]) {}

  async verify(_: VerificationContext) {
    this.calls += 1;
    const result = this.results.shift();
    if (!result) throw new Error("no verification result scripted");
    return structuredClone(result);
  }
}

const success = (value = "ok"): BrowserActionResult => ({
  effectObserved: true,
  evidenceRefs: ["evidence://action"],
  outputs: { value },
});

const missing = (fingerprint: string): BrowserActionResult => ({
  effectObserved: false,
  evidenceRefs: ["evidence://missing"],
  outputs: {},
  stateFingerprint: fingerprint,
  failure: {
    code: "ELEMENT_NOT_FOUND",
    message: "button missing",
    retryable: true,
    nodeId: "click",
    evidenceRefs: ["evidence://missing"],
  },
});

const verified: VerificationResult = {
  verified: true,
  evidenceRefs: ["evidence://verify"],
  detail: "URL matched",
};

function engine(
  browser: ScriptedBrowser,
  runs: MemoryRuns,
  checkpoints: MemoryCheckpoints,
  verifier = new ScriptedVerifier([verified]),
  reasoner = new ScriptedReasoner([]),
  options: {
    repeatedFingerprintLimit?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  return new WorkflowExecutionEngine({
    browser,
    reasoner,
    verifier,
    runs,
    checkpoints,
    now: () => new Date("2026-08-18T12:00:01.000Z"),
    jitter: () => 0.5,
    ...(options.repeatedFingerprintLimit !== undefined
      ? { repeatedFingerprintLimit: options.repeatedFingerprintLimit }
      : {}),
    ...(options.sleep
      ? { sleep: options.sleep }
      : { sleep: async () => undefined }),
  });
}

describe("planRetry", () => {
  it("uses capped exponential backoff without exceeding the attempt budget", () => {
    const policy = {
      ...baseRetry,
      maxAttempts: 5,
      initialBackoffMs: 100,
      maxBackoffMs: 250,
    };
    const transient = missing("a").failure;
    if (!transient) throw new Error("expected failure");

    expect(planRetry(policy, 1, transient)).toEqual({
      retry: true,
      delayMs: 100,
    });
    expect(planRetry(policy, 3, transient)).toEqual({
      retry: true,
      delayMs: 250,
    });
    expect(planRetry(policy, 5, transient)).toEqual({
      retry: false,
      delayMs: 0,
    });
  });
});

describe("WorkflowExecutionEngine", () => {
  it("executes deterministically, verifies the effect, persists outputs, and completes", async () => {
    const initialRun = run();
    const runs = new MemoryRuns(initialRun);
    const checkpoints = new MemoryCheckpoints();
    const browser = new ScriptedBrowser([success("report-open")]);

    const result = await engine(browser, runs, checkpoints).execute({
      scope,
      run: initialRun,
      graph: graph(node()),
    });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(result.checkpoint?.variables).toEqual({ result: "report-open" });
    expect(result.checkpoint?.completedNodeIds).toEqual(["click", "end"]);
    expect(result.checkpoint?.evidenceRefs).toEqual([
      "evidence://action",
      "evidence://verify",
    ]);
  });

  it("uses constrained semantic recovery only after a recoverable deterministic failure", async () => {
    const initialRun = run();
    const runs = new MemoryRuns(initialRun);
    const checkpoints = new MemoryCheckpoints();
    const browser = new ScriptedBrowser([missing("ui-v2")], [success()]);
    const reasoner = new ScriptedReasoner([
      {
        summary: "button moved",
        action: "CLICK",
        arguments: { role: "button" },
        confidence: 0.91,
      },
    ]);

    const result = await engine(
      browser,
      runs,
      checkpoints,
      new ScriptedVerifier([verified]),
      reasoner,
    ).execute({
      scope,
      run: initialRun,
      graph: graph(node({ escalation: "SEMANTIC_RECOVERY" })),
    });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(reasoner.calls).toBe(1);
    expect(browser.semanticCalls).toHaveLength(1);
  });

  it("opens the human circuit after the same unresolved state repeats instead of looping", async () => {
    const initialRun = run();
    const runs = new MemoryRuns(initialRun);
    const checkpoints = new MemoryCheckpoints();
    const browser = new ScriptedBrowser([
      missing("same-page"),
      missing("same-page"),
    ]);
    const sleeps: number[] = [];

    const result = await engine(
      browser,
      runs,
      checkpoints,
      new ScriptedVerifier([]),
      new ScriptedReasoner([]),
      {
        repeatedFingerprintLimit: 2,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    ).execute({
      scope,
      run: initialRun,
      graph: graph(node()),
    });

    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    expect(result.checkpoint?.fingerprintRepeatCount).toBe(2);
    expect(result.checkpoint?.lastFailure?.code).toBe("ELEMENT_NOT_FOUND");
    expect(sleeps).toEqual([100]);
  });

  it("fails with RETRY_BUDGET_EXHAUSTED when transient attempts are consumed without a repeated fingerprint", async () => {
    const retryPolicy = { ...baseRetry, maxAttempts: 2 };
    const initialRun = run();
    const runs = new MemoryRuns(initialRun);
    const checkpoints = new MemoryCheckpoints();
    const browser = new ScriptedBrowser([missing("page-a"), missing("page-b")]);

    const result = await engine(
      browser,
      runs,
      checkpoints,
      new ScriptedVerifier([]),
      new ScriptedReasoner([]),
      { repeatedFingerprintLimit: 5 },
    ).execute({
      scope,
      run: initialRun,
      graph: graph(node({ retryPolicy })),
    });

    expect(result.run.status).toBe("FAILED");
    expect(result.run.failure?.code).toBe("RETRY_BUDGET_EXHAUSTED");
  });

  it("resumes from a durable checkpoint with persisted variables after human repair", async () => {
    const waitingRun = run("WAITING_FOR_HUMAN");
    const checkpoint: RunCheckpoint = {
      runId: waitingRun.runId,
      automationId: waitingRun.automationId,
      workflowVersion: waitingRun.workflowVersion,
      currentNodeId: "click",
      completedNodeIds: [],
      attempt: 2,
      stateFingerprint: "click:ELEMENT_NOT_FOUND:same-page",
      fingerprintRepeatCount: 2,
      variables: { reportId: "R-42" },
      evidenceRefs: ["evidence://before-pause"],
      lastFailure: {
        code: "ELEMENT_NOT_FOUND",
        message: "button missing",
        retryable: true,
        nodeId: "click",
        evidenceRefs: [],
      },
      updatedAt: "2026-08-18T12:00:00.000Z",
    };
    const runs = new MemoryRuns(waitingRun);
    const checkpoints = new MemoryCheckpoints(checkpoint);
    const browser = new ScriptedBrowser([success()]);
    const workflowNode = node({
      inputBindings: { reportId: "reportId" },
    });

    const result = await engine(browser, runs, checkpoints).execute({
      scope,
      run: waitingRun,
      graph: graph(workflowNode),
      resumeFromHuman: true,
    });

    expect(result.run.status).toBe("SUCCEEDED");
    expect(browser.deterministicCalls[0]).toEqual({ reportId: "R-42" });
    expect(result.checkpoint?.fingerprintRepeatCount).toBe(0);
    expect(result.checkpoint?.lastFailure).toBeUndefined();
  });
});
