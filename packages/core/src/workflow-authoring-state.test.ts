import { describe, expect, it } from "vitest";
import type { CaptureTrace } from "@automation/contracts";
import {
  AutomationProductLifecycleService,
  InMemoryCaptureTraceRepository,
  canAuthorWorkflowCapture,
} from "./product-lifecycle.js";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryBrowserProfileStore,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryScheduler,
  InMemoryWorkflowVersionRepository,
} from "./memory.js";
import type {
  BrowserExecutor,
  OwnershipScope,
  ReasoningProvider,
  VerificationEngine,
} from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-author", userId: "user-author" };

const unusedBrowser: BrowserExecutor = {
  async executeDeterministic() {
    throw new Error("browser execution is not expected in workflow-authoring state tests");
  },
  async executeSemantic() {
    throw new Error("browser execution is not expected in workflow-authoring state tests");
  },
};

const unusedVerifier: VerificationEngine = {
  async verify() {
    throw new Error("verification is not expected in workflow-authoring state tests");
  },
};

const unusedReasoner: ReasoningProvider = {
  async decide() {
    throw new Error("reasoning is not expected in workflow-authoring state tests");
  },
};

function trace(profileRef: string, traceId: string): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId,
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "automation-authoring",
    websiteUrl: "https://example.test/app",
    objective: "Submit the approved form",
    browserProfileRef: profileRef,
    startedAt: "2026-08-23T00:00:00.000Z",
    finishedAt: "2026-08-23T00:00:02.000Z",
    events: [
      {
        eventId: `${traceId}-click`,
        sequence: 1,
        kind: "CLICK",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-23T00:00:01.000Z",
        page: { url: "https://example.test/app" },
        target: { testId: "submit", role: "button", accessibleName: "Submit" },
        expectedEffect: {
          description: "Submission confirmation is visible",
          mode: "URL",
          expected: "https://example.test/done",
          timeoutMs: 5_000,
        },
        artifactRefs: [],
      },
    ],
  };
}

function harness() {
  const automations = new InMemoryAutomationRepository();
  const captures = new InMemoryCaptureTraceRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const profiles = new InMemoryBrowserProfileStore();
  const service = new AutomationProductLifecycleService({
    automations,
    captures,
    workflows,
    runs: new InMemoryRunRepository(),
    checkpoints: new InMemoryCheckpointRepository(),
    profiles,
    scheduler: new InMemoryScheduler(),
    locks: new InMemoryAutomationLockManager(() => new Date("2026-08-23T00:10:00.000Z")),
    browser: unusedBrowser,
    verifier: unusedVerifier,
    reasoner: unusedReasoner,
    now: () => new Date("2026-08-23T00:10:00.000Z"),
  });
  return { service, automations, captures, workflows };
}

describe("workflow authoring state", () => {
  it("allows capture only in non-published authoring states", () => {
    expect(canAuthorWorkflowCapture("DRAFT")).toBe(true);
    expect(canAuthorWorkflowCapture("COMPILING")).toBe(true);
    expect(canAuthorWorkflowCapture("READY_TO_TEST")).toBe(true);

    expect(canAuthorWorkflowCapture("READY_TO_PUBLISH")).toBe(false);
    expect(canAuthorWorkflowCapture("ACTIVE")).toBe(false);
    expect(canAuthorWorkflowCapture("RUNNING")).toBe(false);
    expect(canAuthorWorkflowCapture("PAUSED")).toBe(false);
    expect(canAuthorWorkflowCapture("NEEDS_AUTH")).toBe(false);
    expect(canAuthorWorkflowCapture("NEEDS_API_KEY")).toBe(false);
    expect(canAuthorWorkflowCapture("NEEDS_ATTENTION")).toBe(false);
    expect(canAuthorWorkflowCapture("DISABLED")).toBe(false);
  });

  it("requires a newly accepted capture before each immutable compile", async () => {
    const h = harness();
    const draft = await h.service.createDraft({
      scope: owner,
      automationId: "automation-authoring",
      name: "Authoring example",
      websiteUrl: "https://example.test/app",
      objective: "Submit the approved form",
      consentAcknowledged: true,
    });
    const captured = trace(draft.browserProfileRef!, "trace-first");

    await h.service.persistCapture({ scope: owner, trace: captured });
    const graph = await h.service.compile({
      scope: owner,
      automationId: draft.automationId,
      traceId: captured.traceId,
      workflowId: "workflow-authoring",
    });

    expect(graph.version).toBe(1);
    expect((await h.automations.get(owner, draft.automationId))?.status).toBe("READY_TO_TEST");
    await expect(
      h.service.compile({
        scope: owner,
        automationId: draft.automationId,
        traceId: captured.traceId,
        workflowId: "workflow-authoring",
      }),
    ).rejects.toThrow("COMPILING");
    expect(await h.workflows.list(owner, draft.automationId)).toHaveLength(1);
  });

  it("cannot replace an active published workflow by persisting another capture", async () => {
    const h = harness();
    const draft = await h.service.createDraft({
      scope: owner,
      automationId: "automation-authoring",
      name: "Authoring example",
      websiteUrl: "https://example.test/app",
      objective: "Submit the approved form",
      consentAcknowledged: true,
    });
    const first = trace(draft.browserProfileRef!, "trace-first");
    await h.service.persistCapture({ scope: owner, trace: first });
    const graph = await h.service.compile({
      scope: owner,
      automationId: draft.automationId,
      traceId: first.traceId,
      workflowId: "workflow-authoring",
    });
    const ready = await h.automations.get(owner, draft.automationId);
    if (!ready) throw new Error("expected automation record");
    await h.automations.put({
      ...ready,
      status: "ACTIVE",
      publishedWorkflowVersion: graph.version,
      schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "UTC" },
    });

    const replacement = trace(draft.browserProfileRef!, "trace-replacement");
    await expect(h.service.persistCapture({ scope: owner, trace: replacement })).rejects.toThrow(
      "pre-publish workflow-authoring state",
    );
    expect(await h.captures.get(owner, draft.automationId, replacement.traceId)).toBeNull();
    expect((await h.automations.get(owner, draft.automationId))?.status).toBe("ACTIVE");
    expect(await h.workflows.list(owner, draft.automationId)).toHaveLength(1);
  });
});
