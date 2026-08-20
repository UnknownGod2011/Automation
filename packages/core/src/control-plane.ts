import type {
  AutomationRecord,
  AutomationSchedule,
  AutomationStatus,
  CaptureTrace,
  RunRecord,
  WorkflowGraph,
} from "@automation/contracts";
import type { CaptureSessionRecord } from "./capture-completion.js";
import type { ProviderCredentialManagementPort } from "./credential-management.js";
import type { ProviderCredentialSummary } from "./credential-pool.js";
import type { AutomationRepository, OwnershipScope, RunRepository } from "./index.js";
import type {
  AutomationProductLifecycleService,
  FreshTestRunResult,
  PublishAutomationRequest,
} from "./product-lifecycle.js";

export const CONTROL_PLANE_CAPABILITY_STATES = [
  "CONFIGURED",
  "LOCAL_MOCK",
  "NOT_CONFIGURED",
] as const;
export type ControlPlaneCapabilityState = (typeof CONTROL_PLANE_CAPABILITY_STATES)[number];

export interface ControlPlaneCapabilities {
  auth: ControlPlaneCapabilityState;
  capture: ControlPlaneCapabilityState;
  cloudExecution: ControlPlaneCapabilityState;
  scheduling: ControlPlaneCapabilityState;
  notifications: ControlPlaneCapabilityState;
}

export interface LatestCompletedCaptureView {
  traceId: string;
  completedAt: string;
}

export interface AutomationSummaryView {
  automationId: string;
  name: string;
  websiteUrl: string;
  objective: string;
  status: AutomationStatus;
  publishedWorkflowVersion?: number;
  schedule?: AutomationSchedule;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  createdAt: string;
  updatedAt: string;
  latestCompletedCapture?: LatestCompletedCaptureView;
  lastRun?: RunSummaryView;
  needsAttention: boolean;
}

export interface RunSummaryView {
  runId: string;
  automationId: string;
  workflowVersion: number;
  status: RunRecord["status"];
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentNodeId?: string;
  failureCode?: NonNullable<RunRecord["failure"]>["code"];
}

export interface DashboardView {
  capabilities: ControlPlaneCapabilities;
  automations: readonly AutomationSummaryView[];
}

export interface CreateAutomationCommand {
  automationId: string;
  name: string;
  websiteUrl: string;
  objective: string;
  consentAcknowledged: boolean;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
}

export interface CompileAutomationCommand {
  traceId: string;
  workflowId: string;
}

export interface TestAutomationCommand {
  runId: string;
  runtimeVariables?: Readonly<Record<string, unknown>>;
}

export interface PublishAutomationCommand {
  workflowVersion: number;
  schedule: AutomationSchedule;
}

export interface CreateCredentialCommand {
  credentialId: string;
  provider: string;
  apiKey: string;
  maskedLabel: string;
  priority: number;
}

export interface RotateCredentialCommand {
  apiKey: string;
}

export type CaptureStartResult =
  | {
      kind: "READY";
      captureSessionId: string;
      liveViewUrl: string;
      expiresAt: string;
    }
  | { kind: "NOT_CONFIGURED"; reason: string };

export interface CaptureSessionStarter {
  start(scope: OwnershipScope, automation: AutomationRecord): Promise<CaptureStartResult>;
}

export interface CaptureCompletionReader {
  latestCompletedForAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<CaptureSessionRecord | null>;
}

export interface AutomationLifecyclePort {
  createDraft(request: Parameters<AutomationProductLifecycleService["createDraft"]>[0]): ReturnType<AutomationProductLifecycleService["createDraft"]>;
  persistCapture(request: Parameters<AutomationProductLifecycleService["persistCapture"]>[0]): ReturnType<AutomationProductLifecycleService["persistCapture"]>;
  compile(request: Parameters<AutomationProductLifecycleService["compile"]>[0]): ReturnType<AutomationProductLifecycleService["compile"]>;
  runFreshTest(request: Parameters<AutomationProductLifecycleService["runFreshTest"]>[0]): ReturnType<AutomationProductLifecycleService["runFreshTest"]>;
  publish(request: PublishAutomationRequest): ReturnType<AutomationProductLifecycleService["publish"]>;
  history(scope: OwnershipScope, automationId: string): ReturnType<AutomationProductLifecycleService["history"]>;
}

export interface AutomationControlPlaneDependencies {
  automations: AutomationRepository;
  runs: RunRepository;
  lifecycle: AutomationLifecyclePort;
  captureSessions: CaptureSessionStarter;
  captureState: CaptureCompletionReader;
  capabilities: ControlPlaneCapabilities;
  credentials?: ProviderCredentialManagementPort;
}

export class ControlPlaneError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NOT_CONFIGURED",
    message: string,
  ) {
    super(message);
  }
}

const attentionStatuses = new Set<AutomationStatus>([
  "NEEDS_AUTH",
  "NEEDS_API_KEY",
  "NEEDS_ATTENTION",
  "PAUSED",
]);

function requireToken(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

function toRunSummary(run: RunRecord): RunSummaryView {
  return {
    runId: run.runId,
    automationId: run.automationId,
    workflowVersion: run.workflowVersion,
    status: run.status,
    scheduledAt: run.scheduledAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.currentNodeId ? { currentNodeId: run.currentNodeId } : {}),
    ...(run.failure ? { failureCode: run.failure.code } : {}),
  };
}

function toLatestCompletedCapture(record: CaptureSessionRecord | null): LatestCompletedCaptureView | undefined {
  if (!record) return undefined;
  if (record.status !== "COMPLETED" || !record.traceId || !record.completedAt) {
    throw new ControlPlaneError("CONFLICT", "capture completion state is invalid");
  }
  return { traceId: record.traceId, completedAt: record.completedAt };
}

function toAutomationSummary(
  record: AutomationRecord,
  runs: readonly RunRecord[],
  latestCapture: CaptureSessionRecord | null = null,
): AutomationSummaryView {
  const lastRun = [...runs].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
  const latestCompletedCapture = toLatestCompletedCapture(latestCapture);
  return {
    automationId: record.automationId,
    name: record.name,
    websiteUrl: record.websiteUrl,
    objective: record.prompt,
    status: record.status,
    ...(record.publishedWorkflowVersion !== undefined
      ? { publishedWorkflowVersion: record.publishedWorkflowVersion }
      : {}),
    ...(record.schedule ? { schedule: structuredClone(record.schedule) } : {}),
    notifyOnSuccess: record.notifyOnSuccess,
    notifyOnFailure: record.notifyOnFailure,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(latestCompletedCapture ? { latestCompletedCapture } : {}),
    ...(lastRun ? { lastRun: toRunSummary(lastRun) } : {}),
    needsAttention:
      attentionStatuses.has(record.status) || lastRun?.status === "WAITING_FOR_HUMAN",
  };
}

export class AutomationControlPlaneService {
  constructor(private readonly dependencies: AutomationControlPlaneDependencies) {}

  private credentialManagement(): ProviderCredentialManagementPort {
    if (!this.dependencies.credentials) {
      throw new ControlPlaneError("NOT_CONFIGURED", "BYOK credential management is not configured");
    }
    return this.dependencies.credentials;
  }

  async listCredentials(scope: OwnershipScope): Promise<readonly ProviderCredentialSummary[]> {
    return this.credentialManagement().list(scope);
  }

  async createCredential(
    scope: OwnershipScope,
    command: CreateCredentialCommand,
  ): Promise<ProviderCredentialSummary> {
    try {
      return await this.credentialManagement().create({
        scope,
        credentialId: requireToken(command.credentialId, "credentialId"),
        provider: requireToken(command.provider, "provider"),
        apiKey: command.apiKey,
        maskedLabel: requireToken(command.maskedLabel, "maskedLabel"),
        priority: command.priority,
      });
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "credential could not be created");
    }
  }

  async rotateCredential(
    scope: OwnershipScope,
    credentialId: string,
    command: RotateCredentialCommand,
  ): Promise<ProviderCredentialSummary> {
    try {
      return await this.credentialManagement().rotate({
        scope,
        credentialId: requireToken(credentialId, "credentialId"),
        apiKey: command.apiKey,
      });
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "credential could not be rotated");
    }
  }

  async removeCredential(scope: OwnershipScope, credentialId: string): Promise<{ removed: boolean }> {
    try {
      return {
        removed: await this.credentialManagement().remove(
          scope,
          requireToken(credentialId, "credentialId"),
        ),
      };
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "credential could not be removed");
    }
  }

  async dashboard(scope: OwnershipScope): Promise<DashboardView> {
    const automations = await this.dependencies.automations.list(scope);
    const summaries = await Promise.all(
      automations.map(async (automation) => {
        const [runs, latestCapture] = await Promise.all([
          this.dependencies.runs.listForAutomation(scope, automation.automationId),
          this.dependencies.captureState.latestCompletedForAutomation(scope, automation.automationId),
        ]);
        return toAutomationSummary(automation, runs, latestCapture);
      }),
    );
    return {
      capabilities: structuredClone(this.dependencies.capabilities),
      automations: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async getAutomation(scope: OwnershipScope, automationId: string): Promise<AutomationSummaryView> {
    const id = requireToken(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    const [runs, latestCapture] = await Promise.all([
      this.dependencies.runs.listForAutomation(scope, id),
      this.dependencies.captureState.latestCompletedForAutomation(scope, id),
    ]);
    return toAutomationSummary(automation, runs, latestCapture);
  }

  async createAutomation(scope: OwnershipScope, command: CreateAutomationCommand): Promise<AutomationSummaryView> {
    const automationId = requireToken(command.automationId, "automationId");
    if (await this.dependencies.automations.get(scope, automationId)) {
      throw new ControlPlaneError("CONFLICT", "automation already exists");
    }
    try {
      const created = await this.dependencies.lifecycle.createDraft({
        scope,
        automationId,
        name: command.name,
        websiteUrl: command.websiteUrl,
        objective: command.objective,
        consentAcknowledged: command.consentAcknowledged,
        ...(command.notifyOnSuccess !== undefined ? { notifyOnSuccess: command.notifyOnSuccess } : {}),
        ...(command.notifyOnFailure !== undefined ? { notifyOnFailure: command.notifyOnFailure } : {}),
      });
      return toAutomationSummary(created, []);
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("BAD_REQUEST", "automation draft is invalid");
    }
  }

  async beginCapture(scope: OwnershipScope, automationId: string): Promise<CaptureStartResult> {
    const id = requireToken(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");
    const result = await this.dependencies.captureSessions.start(scope, automation);
    if (result.kind === "NOT_CONFIGURED") return result;
    return { ...result };
  }

  async ingestCapture(scope: OwnershipScope, trace: CaptureTrace): Promise<{ traceId: string }> {
    try {
      const persisted = await this.dependencies.lifecycle.persistCapture({ scope, trace });
      return { traceId: persisted.traceId };
    } catch {
      throw new ControlPlaneError("CONFLICT", "capture trace could not be accepted");
    }
  }

  async compileAutomation(
    scope: OwnershipScope,
    automationId: string,
    command: CompileAutomationCommand,
  ): Promise<WorkflowGraph> {
    try {
      return await this.dependencies.lifecycle.compile({
        scope,
        automationId: requireToken(automationId, "automationId"),
        traceId: requireToken(command.traceId, "traceId"),
        workflowId: requireToken(command.workflowId, "workflowId"),
      });
    } catch {
      throw new ControlPlaneError("CONFLICT", "automation could not be compiled from this capture");
    }
  }

  async runFreshTest(
    scope: OwnershipScope,
    automationId: string,
    command: TestAutomationCommand,
  ): Promise<FreshTestRunResult> {
    try {
      return await this.dependencies.lifecycle.runFreshTest({
        scope,
        automationId: requireToken(automationId, "automationId"),
        runId: requireToken(command.runId, "runId"),
        ...(command.runtimeVariables ? { runtimeVariables: structuredClone(command.runtimeVariables) } : {}),
      });
    } catch {
      throw new ControlPlaneError("CONFLICT", "automation is not ready for a fresh test");
    }
  }

  async publishAutomation(
    scope: OwnershipScope,
    automationId: string,
    command: PublishAutomationCommand,
  ): Promise<AutomationSummaryView> {
    try {
      const published = await this.dependencies.lifecycle.publish({
        scope,
        automationId: requireToken(automationId, "automationId"),
        workflowVersion: command.workflowVersion,
        schedule: structuredClone(command.schedule),
      });
      const [runs, latestCapture] = await Promise.all([
        this.dependencies.runs.listForAutomation(scope, published.automationId),
        this.dependencies.captureState.latestCompletedForAutomation(scope, published.automationId),
      ]);
      return toAutomationSummary(published, runs, latestCapture);
    } catch {
      throw new ControlPlaneError("CONFLICT", "automation is not ready to publish with this schedule");
    }
  }

  async history(scope: OwnershipScope, automationId: string): Promise<readonly RunSummaryView[]> {
    try {
      const runs = await this.dependencies.lifecycle.history(
        scope,
        requireToken(automationId, "automationId"),
      );
      return runs.map(toRunSummary);
    } catch {
      throw new ControlPlaneError("NOT_FOUND", "automation not found");
    }
  }
}