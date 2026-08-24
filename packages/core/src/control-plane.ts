import type {
  AutomationRecord,
  AutomationSchedule,
  AutomationStatus,
  CaptureTrace,
  RunRecord,
  WorkflowGraph,
} from "@automation/contracts";
import type { AutomationScheduleLifecycleService } from "./automation-schedule-lifecycle.js";
import type { CaptureSessionRecord } from "./capture-completion.js";
import type { ProviderCredentialManagementPort } from "./credential-management.js";
import type { ProviderCredentialSummary } from "./credential-pool.js";
import type { AutomationRepository, OwnershipScope, RunRepository } from "./index.js";
import type {
  AutomationProductLifecycleService,
  FreshTestRunRequest,
  FreshTestRunResult,
  PublishAutomationRequest,
} from "./product-lifecycle.js";
import { normalizeAutomationTargetUrl } from "./target-url-policy.js";

export const CONTROL_PLANE_CAPABILITY_STATES = ["CONFIGURED", "LOCAL_MOCK", "NOT_CONFIGURED"] as const;
export type ControlPlaneCapabilityState = (typeof CONTROL_PLANE_CAPABILITY_STATES)[number];
export interface ControlPlaneCapabilities { auth: ControlPlaneCapabilityState; capture: ControlPlaneCapabilityState; cloudExecution: ControlPlaneCapabilityState; scheduling: ControlPlaneCapabilityState; notifications: ControlPlaneCapabilityState; }
export interface LatestCompletedCaptureView { completedAt: string; }
export interface AutomationSummaryView {
  automationId: string; name: string; websiteUrl: string; objective: string; status: AutomationStatus;
  publishedWorkflowVersion?: number; schedule?: AutomationSchedule; notifyOnSuccess: boolean; notifyOnFailure: boolean;
  createdAt: string; updatedAt: string; latestCompletedCapture?: LatestCompletedCaptureView; lastRun?: RunSummaryView; needsAttention: boolean;
}
export interface RunSummaryView {
  runId: string; automationId: string; workflowVersion: number; status: RunRecord["status"]; scheduledAt: string;
  startedAt?: string; finishedAt?: string; currentNodeId?: string; failureCode?: NonNullable<RunRecord["failure"]>["code"]; runKind?: "FRESH_TEST" | "SCHEDULED";
}
export interface DashboardView { capabilities: ControlPlaneCapabilities; automations: readonly AutomationSummaryView[]; }
export interface CreateAutomationCommand { automationId: string; name: string; websiteUrl: string; objective: string; consentAcknowledged: boolean; notifyOnSuccess?: boolean; notifyOnFailure?: boolean; }
export interface TestAutomationCommand { runId: string; runtimeVariables?: Readonly<Record<string, unknown>>; }
export interface PublishAutomationCommand {
  workflowVersion: number;
  schedule: AutomationSchedule;
  scheduledNonSecretInputs?: Readonly<Record<string, unknown>>;
  scheduledInputsAreNonSecret?: boolean;
}
export interface UpdateAutomationScheduleCommand { schedule: AutomationSchedule; }
export interface UpdateScheduledInputValuesCommand {
  scheduledNonSecretInputs: Readonly<Record<string, string>>;
  scheduledInputsAreNonSecret: boolean;
}
export interface UpdateNotificationPreferencesCommand { notifyOnSuccess: boolean; notifyOnFailure: boolean; }
export interface CreateCredentialCommand { credentialId: string; provider: string; apiKey: string; maskedLabel: string; priority: number; }
export interface RotateCredentialCommand { apiKey: string; }
export type CaptureStartResult = { kind: "READY"; captureSessionId: string; liveViewUrl: string; expiresAt: string } | { kind: "NOT_CONFIGURED"; reason: string };
export interface CaptureSessionStarter { start(scope: OwnershipScope, automation: AutomationRecord): Promise<CaptureStartResult>; }
export interface CaptureCompletionReader { latestCompletedForAutomation(scope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null>; }
export interface FreshTestAcceptedResult { kind: "ACCEPTED"; runId: string; }
export type FreshTestExecutionResult = FreshTestRunResult | FreshTestAcceptedResult;
/** Trusted execution-plane boundary for production fresh tests. Cloud implementations may acknowledge before long-running execution completes. */
export interface FreshTestExecutionPort { execute(request: FreshTestRunRequest): Promise<FreshTestExecutionResult>; }
export interface AutomationLifecyclePort {
  createDraft(request: Parameters<AutomationProductLifecycleService["createDraft"]>[0]): ReturnType<AutomationProductLifecycleService["createDraft"]>;
  persistCapture(request: Parameters<AutomationProductLifecycleService["persistCapture"]>[0]): ReturnType<AutomationProductLifecycleService["persistCapture"]>;
  compile(request: Parameters<AutomationProductLifecycleService["compile"]>[0]): ReturnType<AutomationProductLifecycleService["compile"]>;
  runFreshTest(request: Parameters<AutomationProductLifecycleService["runFreshTest"]>[0]): ReturnType<AutomationProductLifecycleService["runFreshTest"]>;
  publish(request: PublishAutomationRequest): ReturnType<AutomationProductLifecycleService["publish"]>;
  history(scope: OwnershipScope, automationId: string): ReturnType<AutomationProductLifecycleService["history"]>;
}
export type AutomationScheduleLifecyclePort = Pick<AutomationScheduleLifecycleService, "updateSchedule" | "pause" | "resume" | "disable">;
export interface AutomationControlPlaneDependencies {
  automations: AutomationRepository; runs: RunRepository; lifecycle: AutomationLifecyclePort; captureSessions: CaptureSessionStarter;
  captureState: CaptureCompletionReader; capabilities: ControlPlaneCapabilities; credentials?: ProviderCredentialManagementPort;
  freshTests?: FreshTestExecutionPort; scheduleLifecycle?: AutomationScheduleLifecyclePort; now?: () => Date;
}
export class ControlPlaneError extends Error {
  constructor(readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED", message: string) { super(message); }
}
const attentionStatuses = new Set<AutomationStatus>(["NEEDS_AUTH", "NEEDS_API_KEY", "NEEDS_ATTENTION", "PAUSED"]);
const MAX_SCHEDULED_INPUTS = 64;
const MAX_SCHEDULED_INPUT_VALUE_CHARS = 4_096;
const MAX_SCHEDULED_INPUT_TOTAL_CHARS = 32_768;
function requireToken(value: string, name: string): string { const trimmed = value.trim(); if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`); if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`); return trimmed; }
function matchesCreateReplay(record: AutomationRecord, command: CreateAutomationCommand): boolean {
  if (command.consentAcknowledged !== true) return false;
  try {
    return record.name === command.name.trim()
      && record.websiteUrl === normalizeAutomationTargetUrl(command.websiteUrl.trim())
      && record.prompt === command.objective.trim();
  } catch {
    return false;
  }
}
function classifyRunKind(run: RunRecord): NonNullable<RunSummaryView["runKind"]> { return run.occurrenceKey === `${run.automationId}:test:${run.runId}` ? "FRESH_TEST" : "SCHEDULED"; }
function toRunSummary(run: RunRecord): RunSummaryView {
  return { runId: run.runId, automationId: run.automationId, workflowVersion: run.workflowVersion, status: run.status, scheduledAt: run.scheduledAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.currentNodeId ? { currentNodeId: run.currentNodeId } : {}), ...(run.failure ? { failureCode: run.failure.code } : {}), runKind: classifyRunKind(run) };
}
function completedCapture(record: CaptureSessionRecord | null): CaptureSessionRecord | null {
  if (!record) return null;
  if (record.status !== "COMPLETED" || !record.traceId || !record.completedAt) throw new ControlPlaneError("CONFLICT", "capture completion state is invalid");
  return record;
}
function toLatestCompletedCapture(record: CaptureSessionRecord | null): LatestCompletedCaptureView | undefined {
  const completed = completedCapture(record);
  return completed ? { completedAt: completed.completedAt! } : undefined;
}
function toAutomationSummary(record: AutomationRecord, runs: readonly RunRecord[], latestCapture: CaptureSessionRecord | null = null): AutomationSummaryView {
  const lastRun = [...runs].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
  const latestCompletedCapture = toLatestCompletedCapture(latestCapture);
  return { automationId: record.automationId, name: record.name, websiteUrl: record.websiteUrl, objective: record.prompt, status: record.status,
    ...(record.publishedWorkflowVersion !== undefined ? { publishedWorkflowVersion: record.publishedWorkflowVersion } : {}),
    ...(record.schedule ? { schedule: structuredClone(record.schedule) } : {}), notifyOnSuccess: record.notifyOnSuccess, notifyOnFailure: record.notifyOnFailure,
    createdAt: record.createdAt, updatedAt: record.updatedAt, ...(latestCompletedCapture ? { latestCompletedCapture } : {}),
    ...(lastRun ? { lastRun: toRunSummary(lastRun) } : {}), needsAttention: attentionStatuses.has(record.status) || lastRun?.status === "WAITING_FOR_HUMAN" };
}
function sameStringMap(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value);
}
function validateScheduledInputReplacement(
  current: Readonly<Record<string, string>>,
  supplied: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const expectedKeys = Object.keys(current).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const entries = Object.entries(supplied);
  if (expectedKeys.length === 0) throw new ControlPlaneError("CONFLICT", "published workflow has no configurable scheduled inputs");
  if (entries.length > MAX_SCHEDULED_INPUTS) throw new ControlPlaneError("BAD_REQUEST", "too many scheduled non-secret inputs");
  const suppliedKeys = entries.map(([key]) => key).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (suppliedKeys.length !== expectedKeys.length || suppliedKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new ControlPlaneError("BAD_REQUEST", "scheduled input keys must exactly match the published workflow configuration");
  }
  let totalChars = 0;
  const normalized: Record<string, string> = {};
  for (const key of expectedKeys) {
    const value = supplied[key];
    if (typeof value !== "string") throw new ControlPlaneError("BAD_REQUEST", "scheduled non-secret input values must be strings");
    if (value.length > MAX_SCHEDULED_INPUT_VALUE_CHARS) throw new ControlPlaneError("BAD_REQUEST", "scheduled non-secret input value is too long");
    totalChars += value.length;
    if (totalChars > MAX_SCHEDULED_INPUT_TOTAL_CHARS) throw new ControlPlaneError("BAD_REQUEST", "scheduled non-secret inputs are too large");
    normalized[key] = value;
  }
  return normalized;
}

export class AutomationControlPlaneService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: AutomationControlPlaneDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  private credentialManagement(): ProviderCredentialManagementPort { if (!this.dependencies.credentials) throw new ControlPlaneError("NOT_CONFIGURED", "BYOK credential management is not configured"); return this.dependencies.credentials; }
  private requireSchedulingCapability(): void { if (this.dependencies.capabilities.scheduling === "NOT_CONFIGURED") throw new ControlPlaneError("NOT_CONFIGURED", "automation scheduling is not configured"); }
  private scheduleManagement(): AutomationScheduleLifecyclePort { this.requireSchedulingCapability(); if (!this.dependencies.scheduleLifecycle) throw new ControlPlaneError("NOT_CONFIGURED", "automation schedule management is not configured"); return this.dependencies.scheduleLifecycle; }
  private async requireOwnedAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationRecord> { const automation = await this.dependencies.automations.get(scope, automationId); if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found"); return automation; }
  private async summaryFor(record: AutomationRecord): Promise<AutomationSummaryView> {
    const scope = { tenantId: record.tenantId, userId: record.userId };
    const [runs, latestCapture] = await Promise.all([this.dependencies.runs.listForAutomation(scope, record.automationId), this.dependencies.captureState.latestCompletedForAutomation(scope, record.automationId)]);
    return toAutomationSummary(record, runs, latestCapture);
  }
  async listCredentials(scope: OwnershipScope): Promise<readonly ProviderCredentialSummary[]> { return this.credentialManagement().list(scope); }
  async createCredential(scope: OwnershipScope, command: CreateCredentialCommand): Promise<ProviderCredentialSummary> {
    try { return await this.credentialManagement().create({ scope, credentialId: requireToken(command.credentialId, "credentialId"), provider: requireToken(command.provider, "provider"), apiKey: command.apiKey, maskedLabel: requireToken(command.maskedLabel, "maskedLabel"), priority: command.priority }); }
    catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "credential could not be created"); }
  }
  async rotateCredential(scope: OwnershipScope, credentialId: string, command: RotateCredentialCommand): Promise<ProviderCredentialSummary> {
    try { return await this.credentialManagement().rotate({ scope, credentialId: requireToken(credentialId, "credentialId"), apiKey: command.apiKey }); }
    catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "credential could not be rotated"); }
  }
  async removeCredential(scope: OwnershipScope, credentialId: string): Promise<{ removed: boolean }> {
    try { return { removed: await this.credentialManagement().remove(scope, requireToken(credentialId, "credentialId")) }; }
    catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "credential could not be removed"); }
  }
  async dashboard(scope: OwnershipScope): Promise<DashboardView> {
    const automations = await this.dependencies.automations.list(scope);
    const summaries = await Promise.all(automations.map(async (automation) => {
      const [runs, latestCapture] = await Promise.all([this.dependencies.runs.listForAutomation(scope, automation.automationId), this.dependencies.captureState.latestCompletedForAutomation(scope, automation.automationId)]);
      return toAutomationSummary(automation, runs, latestCapture);
    }));
    return { capabilities: structuredClone(this.dependencies.capabilities), automations: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }
  async getAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId"); const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    const [runs, latestCapture] = await Promise.all([this.dependencies.runs.listForAutomation(scope, id), this.dependencies.captureState.latestCompletedForAutomation(scope, id)]);
    return toAutomationSummary(automation, runs, latestCapture);
  }
  async createAutomation(scope: OwnershipScope, command: CreateAutomationCommand): Promise<AutomationSummaryView> {
    const automationId = requireToken(command.automationId, "automationId");
    const existing = await this.dependencies.automations.get(scope, automationId);
    if (existing) {
      if (!matchesCreateReplay(existing, command)) throw new ControlPlaneError("CONFLICT", "automation already exists");
      return this.summaryFor(existing);
    }
    try {
      const created = await this.dependencies.lifecycle.createDraft({ scope, automationId, name: command.name, websiteUrl: command.websiteUrl, objective: command.objective, consentAcknowledged: command.consentAcknowledged,
        ...(command.notifyOnSuccess !== undefined ? { notifyOnSuccess: command.notifyOnSuccess } : {}), ...(command.notifyOnFailure !== undefined ? { notifyOnFailure: command.notifyOnFailure } : {}) });
      return toAutomationSummary(created, []);
    } catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("BAD_REQUEST", "automation draft is invalid"); }
  }
  async updateNotificationPreferences(scope: OwnershipScope, automationId: string, command: UpdateNotificationPreferencesCommand): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    if (automation.notifyOnSuccess === command.notifyOnSuccess && automation.notifyOnFailure === command.notifyOnFailure) {
      return this.summaryFor(automation);
    }
    const updated: AutomationRecord = {
      ...automation,
      notifyOnSuccess: command.notifyOnSuccess,
      notifyOnFailure: command.notifyOnFailure,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.dependencies.automations.put(updated);
      return await this.summaryFor(updated);
    } catch {
      throw new ControlPlaneError("CONFLICT", "notification preferences could not be updated");
    }
  }
  async updateScheduledInputValues(scope: OwnershipScope, automationId: string, command: UpdateScheduledInputValuesCommand): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    if (automation.status !== "ACTIVE" && automation.status !== "PAUSED") {
      throw new ControlPlaneError("CONFLICT", "scheduled inputs may be changed only for ACTIVE or PAUSED automations");
    }
    if (automation.publishedWorkflowVersion === undefined || !automation.schedule) {
      throw new ControlPlaneError("CONFLICT", "automation must be published before scheduled inputs can be changed");
    }
    if (command.scheduledInputsAreNonSecret !== true) {
      throw new ControlPlaneError("BAD_REQUEST", "scheduled inputs require explicit non-secret acknowledgement");
    }
    const current = automation.scheduledNonSecretInputs ?? {};
    const scheduledNonSecretInputs = validateScheduledInputReplacement(current, command.scheduledNonSecretInputs);
    if (sameStringMap(current, scheduledNonSecretInputs)) return this.summaryFor(automation);
    const updated: AutomationRecord = {
      ...automation,
      scheduledNonSecretInputs,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.dependencies.automations.put(updated);
      return await this.summaryFor(updated);
    } catch {
      throw new ControlPlaneError("CONFLICT", "scheduled inputs could not be updated");
    }
  }
  async beginCapture(scope: OwnershipScope, automationId: string): Promise<CaptureStartResult> {
    const id = requireToken(automationId, "automationId"); const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    if (this.dependencies.capabilities.capture === "NOT_CONFIGURED") {
      return { kind: "NOT_CONFIGURED", reason: "AgentCore capture is not configured" };
    }
    const result = await this.dependencies.captureSessions.start(scope, automation); return result.kind === "NOT_CONFIGURED" ? result : { ...result };
  }
  async ingestCapture(scope: OwnershipScope, trace: CaptureTrace): Promise<{ traceId: string }> {
    try { const persisted = await this.dependencies.lifecycle.persistCapture({ scope, trace }); return { traceId: persisted.traceId }; }
    catch { throw new ControlPlaneError("CONFLICT", "capture trace could not be accepted"); }
  }
  async compileAutomation(scope: OwnershipScope, automationId: string): Promise<WorkflowGraph> {
    const id = requireToken(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    const capture = completedCapture(await this.dependencies.captureState.latestCompletedForAutomation(scope, id));
    if (!capture) throw new ControlPlaneError("CONFLICT", "a completed capture is required before compilation");
    try { return await this.dependencies.lifecycle.compile({ scope, automationId: id, traceId: capture.traceId!, workflowId: id }); }
    catch { throw new ControlPlaneError("CONFLICT", "automation could not be compiled from the latest capture"); }
  }
  async runFreshTest(scope: OwnershipScope, automationId: string, command: TestAutomationCommand): Promise<FreshTestExecutionResult> {
    const id = requireToken(automationId, "automationId");
    const runId = requireToken(command.runId, "runId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    if (automation.status !== "READY_TO_TEST" && automation.status !== "READY_TO_PUBLISH") {
      throw new ControlPlaneError("CONFLICT", "automation is not ready for a fresh test");
    }
    const request: FreshTestRunRequest = { scope, automationId: id, runId, ...(command.runtimeVariables ? { runtimeVariables: structuredClone(command.runtimeVariables) } : {}) };
    const cloudExecution = this.dependencies.capabilities.cloudExecution;
    if (cloudExecution === "NOT_CONFIGURED") {
      throw new ControlPlaneError("NOT_CONFIGURED", "fresh-test execution is not configured");
    }
    if (cloudExecution === "CONFIGURED") {
      if (!this.dependencies.freshTests) throw new ControlPlaneError("NOT_CONFIGURED", "cloud fresh-test execution is not configured");
      try { return await this.dependencies.freshTests.execute(request); }
      catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "cloud fresh test could not be submitted"); }
    }
    try { return await this.dependencies.lifecycle.runFreshTest(request); }
    catch { throw new ControlPlaneError("CONFLICT", "automation is not ready for a fresh test"); }
  }
  async publishAutomation(scope: OwnershipScope, automationId: string, command: PublishAutomationCommand): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    await this.requireOwnedAutomation(scope, id);
    this.requireSchedulingCapability();
    try {
      const published = await this.dependencies.lifecycle.publish({
        scope,
        automationId: id,
        workflowVersion: command.workflowVersion,
        schedule: structuredClone(command.schedule),
        ...(command.scheduledNonSecretInputs ? { scheduledNonSecretInputs: structuredClone(command.scheduledNonSecretInputs) } : {}),
        ...(command.scheduledInputsAreNonSecret !== undefined ? { scheduledInputsAreNonSecret: command.scheduledInputsAreNonSecret } : {}),
      });
      return await this.summaryFor(published);
    } catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "automation is not ready to publish with this schedule"); }
  }
  async updateAutomationSchedule(scope: OwnershipScope, automationId: string, command: UpdateAutomationScheduleCommand): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    await this.requireOwnedAutomation(scope, id);
    try { const updated = await this.scheduleManagement().updateSchedule({ scope, automationId: id, schedule: structuredClone(command.schedule) }); return await this.summaryFor(updated); }
    catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", "automation schedule could not be updated"); }
  }
  async pauseAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationSummaryView> { return this.changeScheduleState(scope, automationId, "pause"); }
  async resumeAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationSummaryView> { return this.changeScheduleState(scope, automationId, "resume"); }
  async disableAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationSummaryView> { return this.changeScheduleState(scope, automationId, "disable"); }
  private async changeScheduleState(scope: OwnershipScope, automationId: string, operation: "pause" | "resume" | "disable"): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    await this.requireOwnedAutomation(scope, id);
    try { const lifecycle = this.scheduleManagement(); const request = { scope, automationId: id }; const updated = await lifecycle[operation](request); return await this.summaryFor(updated); }
    catch (error) { if (error instanceof ControlPlaneError) throw error; throw new ControlPlaneError("CONFLICT", `automation could not be ${operation}d`); }
  }
  async history(scope: OwnershipScope, automationId: string): Promise<readonly RunSummaryView[]> {
    try { const runs = await this.dependencies.lifecycle.history(scope, requireToken(automationId, "automationId")); return runs.map(toRunSummary); }
    catch { throw new ControlPlaneError("NOT_FOUND", "automation not found"); }
  }
}
