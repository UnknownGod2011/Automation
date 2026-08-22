import { describe, expect, it } from "vitest";
import type { CaptureTrace, RunRecord, WorkflowNode } from "@automation/contracts";
import { AutomationProductLifecycleService, InMemoryCaptureTraceRepository } from "./product-lifecycle.js";
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
  BrowserActionResult,
  BrowserExecutor,
  OwnershipScope,
  ReasoningDecision,
  ReasoningProvider,
  ReasoningRequest,
  VerificationContext,
  VerificationEngine,
  VerificationResult,
} from "./index.js";

class RecordingBrowser implements BrowserExecutor {
  readonly calls: Array<{ runId: string; node: WorkflowNode; inputs: Readonly<Record<string, unknown>> }> = [];
  async executeDeterministic(_scope: OwnershipScope, runId: string, node: WorkflowNode, inputs: Readonly<Record<string, unknown>>): Promise<BrowserActionResult> {
    this.calls.push({ runId, node, inputs: structuredClone(inputs) });
    return { effectObserved: true, evidenceRefs: [`memory-evidence://${runId}/${node.id}`], outputs: {}, stateFingerprint: `${node.id}:ok` };
  }
  async executeSemantic(_scope: OwnershipScope, _runId: string, _node: WorkflowNode, _decision: ReasoningDecision, _inputs: Readonly<Record<string, unknown>>): Promise<BrowserActionResult> {
    throw new Error("semantic fallback should not be needed in deterministic local lifecycle test");
  }
}
class AlwaysVerified implements VerificationEngine {
  async verify(context: VerificationContext): Promise<VerificationResult> { return { verified: true, evidenceRefs: [`memory-verification://${context.runId}/${context.node.id}`], detail: "fixture effect verified" }; }
}
class UnexpectedReasoner implements ReasoningProvider {
  async decide(_request: ReasoningRequest): Promise<ReasoningDecision> { throw new Error("reasoner should not be called for deterministic fixture"); }
}
const owner: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const otherOwner: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };

function captureTrace(profileRef: string): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-1",
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "automation-1",
    websiteUrl: "https://example.test/app",
    objective: "Send the monthly report to the chosen recipient",
    browserProfileRef: profileRef,
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: "2026-08-19T12:00:10.000Z",
    events: [
      { eventId: "auth-password", sequence: 1, kind: "INPUT", purpose: "AUTH_SETUP", occurredAt: "2026-08-19T12:00:01.000Z", page: { url: "https://example.test/login" }, target: { role: "textbox", accessibleName: "Password" }, input: { kind: "RUNTIME_VARIABLE", variableName: "auth.password", sensitive: true }, artifactRefs: [] },
      { eventId: "open-report", sequence: 2, kind: "CLICK", purpose: "WORKFLOW", occurredAt: "2026-08-19T12:00:03.000Z", page: { url: "https://example.test/app" }, target: { testId: "open-report", role: "button", accessibleName: "Open report" }, expectedEffect: { description: "Report editor is visible", mode: "TEXT", expected: "Monthly report", timeoutMs: 5_000 }, artifactRefs: [] },
      { eventId: "report-title", sequence: 3, kind: "INPUT", purpose: "WORKFLOW", occurredAt: "2026-08-19T12:00:05.000Z", page: { url: "https://example.test/app/report" }, target: { testId: "report-title", role: "textbox", accessibleName: "Report title" }, input: { kind: "PUBLIC_LITERAL", value: "Monthly report" }, expectedEffect: { description: "Report title field contains the captured title", mode: "DOM", expected: "Monthly report", timeoutMs: 5_000 }, artifactRefs: [] },
      { eventId: "recipient", sequence: 4, kind: "INPUT", purpose: "WORKFLOW", occurredAt: "2026-08-19T12:00:07.000Z", page: { url: "https://example.test/app/report" }, target: { testId: "recipient", role: "textbox", accessibleName: "Recipient" }, input: { kind: "RUNTIME_VARIABLE", variableName: "capture_input_4", sensitive: true }, expectedEffect: { description: "Recipient field is populated", mode: "DOM", expected: "recipient-present", timeoutMs: 5_000 }, artifactRefs: [] },
      { eventId: "send-report", sequence: 5, kind: "SUBMIT", purpose: "WORKFLOW", occurredAt: "2026-08-19T12:00:09.000Z", page: { url: "https://example.test/app/report" }, target: { testId: "send-report", role: "button", accessibleName: "Send report" }, expectedEffect: { description: "Success confirmation is visible", mode: "TEXT", expected: "Report sent", timeoutMs: 10_000 }, artifactRefs: [] },
    ],
  };
}
function harness() {
  const automations = new InMemoryAutomationRepository();
  const captures = new InMemoryCaptureTraceRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const profiles = new InMemoryBrowserProfileStore();
  const scheduler = new InMemoryScheduler();
  const locks = new InMemoryAutomationLockManager(() => new Date("2026-08-19T12:30:00.000Z"));
  const browser = new RecordingBrowser();
  const service = new AutomationProductLifecycleService({ automations, captures, workflows, runs, checkpoints, profiles, scheduler, locks, browser, verifier: new AlwaysVerified(), reasoner: new UnexpectedReasoner(), now: () => new Date("2026-08-19T12:30:00.000Z") });
  return { service, automations, captures, workflows, runs, checkpoints, profiles, scheduler, browser };
}
async function createCompile(h: ReturnType<typeof harness>) {
  const draft = await h.service.createDraft({ scope: owner, automationId: "automation-1", name: "Monthly report sender", websiteUrl: "https://example.test/app", objective: "Send the monthly report to the chosen recipient", consentAcknowledged: true, notifyOnSuccess: true });
  const trace = captureTrace(draft.browserProfileRef!);
  await h.service.persistCapture({ scope: owner, trace });
  const graph = await h.service.compile({ scope: owner, automationId: draft.automationId, traceId: trace.traceId, workflowId: "workflow-automation-1" });
  return { draft, trace, graph };
}

describe("AutomationProductLifecycleService", () => {
  it("proves create -> capture -> compile -> fresh test -> configured publish -> scheduled execution -> history", async () => {
    const h = harness();
    const { graph } = await createCompile(h);
    expect(graph.entryNodeId).toBe("capture-start");
    expect(JSON.stringify(graph)).not.toContain("auth.password");
    expect(JSON.stringify(graph)).not.toContain("finance-team");

    const testResult = await h.service.runFreshTest({ scope: owner, automationId: "automation-1", runId: "test-run-1", runtimeVariables: { capture_input_4: "finance-team" } });
    expect(testResult.kind).toBe("EXECUTED");
    if (testResult.kind !== "EXECUTED") throw new Error("expected test execution");
    expect(testResult.execution.run.status).toBe("SUCCEEDED");
    expect(h.browser.calls.filter((call) => call.node.kind === "TYPE").map((call) => call.inputs.value)).toEqual(["Monthly report", "finance-team"]);

    await expect(h.service.publish({ scope: owner, automationId: "automation-1", workflowVersion: graph.version, schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Asia/Kolkata" } })).rejects.toThrow("acknowledgement");

    const published = await h.service.publish({
      scope: owner,
      automationId: "automation-1",
      workflowVersion: graph.version,
      schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Asia/Kolkata" },
      scheduledNonSecretInputs: { capture_input_4: "ops-team" },
      scheduledInputsAreNonSecret: true,
    });
    expect(published.status).toBe("ACTIVE");
    expect(published.scheduledNonSecretInputs).toEqual({ capture_input_4: "ops-team" });
    expect((await h.scheduler.get(owner, "automation:automation-1"))?.enabled).toBe(true);

    const callsBeforeScheduledRun = h.browser.calls.length;
    const scheduled = await h.service.dispatchOccurrence({ scope: owner, automationId: "automation-1", scheduledAt: "2026-08-20T03:30:00.000Z", runId: "scheduled-run-1" });
    expect(scheduled.kind).toBe("EXECUTED");
    if (scheduled.kind !== "EXECUTED") throw new Error("expected scheduled execution");
    expect(scheduled.execution.run.status).toBe("SUCCEEDED");
    expect(h.browser.calls.length).toBeGreaterThan(callsBeforeScheduledRun);
    expect(h.browser.calls.filter((call) => call.runId === "scheduled-run-1" && call.node.kind === "TYPE").map((call) => call.inputs.value)).toEqual(["Monthly report", "ops-team"]);

    const callsAfterScheduledRun = h.browser.calls.length;
    const duplicate = await h.service.dispatchOccurrence({ scope: owner, automationId: "automation-1", scheduledAt: "2026-08-20T03:30:00.000Z", runId: "scheduled-run-duplicate-delivery", runtimeVariables: { capture_input_4: "must-not-execute" } });
    expect(duplicate.kind).toBe("NOT_RUN");
    if (duplicate.kind !== "NOT_RUN") throw new Error("expected duplicate suppression");
    expect(duplicate.preparation.kind).toBe("DUPLICATE");
    expect(h.browser.calls).toHaveLength(callsAfterScheduledRun);
    const history = await h.service.history(owner, "automation-1");
    expect(history.map((run: RunRecord) => run.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
  });

  it("rejects missing or unrelated scheduled values before Scheduler activation", async () => {
    const h = harness();
    const { graph } = await createCompile(h);
    await h.service.runFreshTest({ scope: owner, automationId: "automation-1", runId: "test-config", runtimeVariables: { capture_input_4: "finance-team" } });
    await expect(h.service.publish({ scope: owner, automationId: "automation-1", workflowVersion: graph.version, schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Asia/Kolkata" }, scheduledInputsAreNonSecret: true })).rejects.toThrow("requires scheduled");
    await expect(h.service.publish({ scope: owner, automationId: "automation-1", workflowVersion: graph.version, schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Asia/Kolkata" }, scheduledNonSecretInputs: { capture_input_4: "ops", capture_input_5: "extra" }, scheduledInputsAreNonSecret: true })).rejects.toThrow("does not belong");
    expect(await h.scheduler.get(owner, "automation:automation-1")).toBeNull();
  });

  it("keeps runtime values out of compiled workflow persistence while seeding them into fresh checkpoints", async () => {
    const h = harness();
    const { graph } = await createCompile(h);
    expect(graph.initialVariables).toEqual({ "capture.report-title.value": "Monthly report" });
    expect(JSON.stringify(graph)).not.toContain("runtime-team");
    await h.service.runFreshTest({ scope: owner, automationId: "automation-1", runId: "test-run-runtime", runtimeVariables: { capture_input_4: "runtime-team" } });
    const checkpoint = await h.checkpoints.get(owner, "test-run-runtime");
    expect(checkpoint?.variables["capture.report-title.value"]).toBe("Monthly report");
    expect(checkpoint?.variables.capture_input_4).toBe("runtime-team");
  });

  it("fails closed on missing consent, cross-tenant access, capture replacement, and invalid publish ordering", async () => {
    const h = harness();
    await expect(h.service.createDraft({ scope: owner, automationId: "no-consent", name: "No consent", websiteUrl: "https://example.test/app", objective: "Do something", consentAcknowledged: false })).rejects.toThrow("consent");
    const { trace, graph } = await createCompile(h);
    await expect(h.service.persistCapture({ scope: owner, trace })).rejects.toThrow("already exists");
    await expect(h.service.history(otherOwner, "automation-1")).rejects.toThrow("does not exist");
    await expect(h.service.publish({ scope: owner, automationId: "automation-1", workflowVersion: graph.version, schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Asia/Kolkata" } })).rejects.toThrow("successful fresh test");
    await expect(h.captures.get(otherOwner, "automation-1", trace.traceId)).resolves.toBeNull();
  });

  it("rejects invalid schedule timezones before activating an automation", async () => {
    const h = harness();
    const { graph } = await createCompile(h);
    await h.service.runFreshTest({ scope: owner, automationId: "automation-1", runId: "test-before-invalid-schedule", runtimeVariables: { capture_input_4: "finance-team" } });
    await expect(h.service.publish({ scope: owner, automationId: "automation-1", workflowVersion: graph.version, schedule: { kind: "DAILY", expression: "0 9 * * *", timezone: "Mars/Olympus" }, scheduledNonSecretInputs: { capture_input_4: "ops-team" }, scheduledInputsAreNonSecret: true })).rejects.toThrow("IANA timezone");
    expect((await h.automations.get(owner, "automation-1"))?.status).toBe("READY_TO_PUBLISH");
  });
});
