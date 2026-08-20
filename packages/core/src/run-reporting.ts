import type {
  AutomationRecord,
  FailureCode,
  RunCheckpoint,
  RunRecord,
  RunStatus,
} from "@automation/contracts";
import type { NotificationPort, OwnershipScope } from "./index.js";
import type { ScheduledRunWorkerResult } from "./worker.js";

export type ScheduledRunTelemetryOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "NEEDS_ATTENTION"
  | "SKIPPED"
  | "DUPLICATE";

export interface ScheduledRunTelemetryEvent {
  eventName: "scheduled_run_outcome";
  observedAt: string;
  tenantId: string;
  userId: string;
  automationId: string;
  runId: string;
  workflowVersion: number;
  scheduledAt: string;
  runStatus: RunStatus;
  outcome: ScheduledRunTelemetryOutcome;
  cleanupWarningCount: number;
  durationMs?: number;
  nodeId?: string;
  failureCode?: FailureCode;
}

export interface RunTelemetryPort {
  emit(event: ScheduledRunTelemetryEvent): Promise<void>;
}

export interface ScheduledRunOutcomeReport {
  telemetryDelivered: boolean;
  notificationDelivered: boolean;
  warnings: readonly string[];
}

export interface ScheduledRunOutcomeReporterDependencies {
  telemetry: RunTelemetryPort;
  notifications?: NotificationPort;
  now?: () => Date;
  warn?: (message: string) => void;
}

export interface ScheduledRunOutcomeContext {
  scope: OwnershipScope;
  automation: AutomationRecord;
  result: ScheduledRunWorkerResult;
  checkpoint?: RunCheckpoint | null;
}

function resultRun(result: ScheduledRunWorkerResult): RunRecord {
  return result.kind === "EXECUTED" ? result.execution.run : result.preparation.run;
}

function resultCheckpoint(
  result: ScheduledRunWorkerResult,
  fallback?: RunCheckpoint | null,
): RunCheckpoint | null {
  return result.kind === "EXECUTED" ? result.execution.checkpoint : (fallback ?? null);
}

function outcomeFor(result: ScheduledRunWorkerResult, run: RunRecord): ScheduledRunTelemetryOutcome {
  if (result.kind === "NOT_RUN") {
    if (result.preparation.kind === "DUPLICATE") return "DUPLICATE";
    if (result.preparation.kind === "SKIPPED") return "SKIPPED";
  }
  if (run.status === "SUCCEEDED") return "SUCCEEDED";
  if (run.status === "WAITING_FOR_HUMAN") return "NEEDS_ATTENTION";
  if (run.status === "SKIPPED" || run.status === "CANCELED") return "SKIPPED";
  return "FAILED";
}

function durationMs(run: RunRecord): number | undefined {
  if (!run.startedAt || !run.finishedAt) return undefined;
  const start = Date.parse(run.startedAt);
  const finish = Date.parse(run.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return undefined;
  return finish - start;
}

function notificationFor(
  automation: AutomationRecord,
  run: RunRecord,
  outcome: ScheduledRunTelemetryOutcome,
  failureCode?: FailureCode,
) {
  if (outcome === "DUPLICATE" || outcome === "SKIPPED") return null;
  if (outcome === "SUCCEEDED") {
    if (!automation.notifyOnSuccess) return null;
    return {
      kind: "RUN_SUCCEEDED" as const,
      recipientUserId: run.userId,
      automationId: run.automationId,
      runId: run.runId,
      subject: `Automation succeeded: ${automation.name}`,
      body: `Your automation completed successfully.\n\nAutomation: ${automation.name}\nRun: ${run.runId}\nStatus: SUCCEEDED`,
    };
  }
  if (outcome === "NEEDS_ATTENTION") {
    const kind = failureCode === "TARGET_AUTH_REQUIRED"
      ? "AUTH_REQUIRED" as const
      : failureCode === "PROVIDER_AUTH_INVALID" || failureCode === "PROVIDER_QUOTA_EXHAUSTED"
        ? "API_KEY_REQUIRED" as const
        : "NEEDS_ATTENTION" as const;
    return {
      kind,
      recipientUserId: run.userId,
      automationId: run.automationId,
      runId: run.runId,
      subject: `Automation needs attention: ${automation.name}`,
      body: `Your automation paused and needs attention.\n\nAutomation: ${automation.name}\nRun: ${run.runId}\nFailure code: ${failureCode ?? "UNKNOWN"}`,
    };
  }
  if (!automation.notifyOnFailure) return null;
  return {
    kind: "RUN_FAILED" as const,
    recipientUserId: run.userId,
    automationId: run.automationId,
    runId: run.runId,
    subject: `Automation failed: ${automation.name}`,
    body: `Your automation did not complete.\n\nAutomation: ${automation.name}\nRun: ${run.runId}\nFailure code: ${failureCode ?? "UNKNOWN"}`,
  };
}

/**
 * Best-effort product reporting around durable execution authority.
 *
 * Notification/telemetry failures never mutate the run or reinterpret its
 * outcome. Error details are deliberately reduced to fixed warnings so
 * provider exceptions cannot leak secrets into ordinary logs.
 */
export class ScheduledRunOutcomeReporter {
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;

  constructor(private readonly dependencies: ScheduledRunOutcomeReporterDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.warn = dependencies.warn ?? (() => undefined);
  }

  async report(context: ScheduledRunOutcomeContext): Promise<ScheduledRunOutcomeReport> {
    const run = resultRun(context.result);
    if (
      run.tenantId !== context.scope.tenantId ||
      run.userId !== context.scope.userId ||
      run.automationId !== context.automation.automationId
    ) {
      throw new Error("scheduled run reporting ownership does not match context");
    }

    const checkpoint = resultCheckpoint(context.result, context.checkpoint);
    const failure = run.failure ?? checkpoint?.lastFailure;
    const outcome = outcomeFor(context.result, run);
    const warnings: string[] = [];
    const duration = durationMs(run);
    const event: ScheduledRunTelemetryEvent = {
      eventName: "scheduled_run_outcome",
      observedAt: this.now().toISOString(),
      tenantId: run.tenantId,
      userId: run.userId,
      automationId: run.automationId,
      runId: run.runId,
      workflowVersion: run.workflowVersion,
      scheduledAt: run.scheduledAt,
      runStatus: run.status,
      outcome,
      cleanupWarningCount: context.result.cleanupWarnings.length,
      ...(duration !== undefined ? { durationMs: duration } : {}),
      ...(run.currentNodeId ? { nodeId: run.currentNodeId } : {}),
      ...(failure ? { failureCode: failure.code } : {}),
    };

    let telemetryDelivered = false;
    try {
      await this.dependencies.telemetry.emit(event);
      telemetryDelivered = true;
    } catch {
      const warning = "scheduled run telemetry delivery failed";
      warnings.push(warning);
      this.warn(warning);
    }

    let notificationDelivered = false;
    const notification = notificationFor(context.automation, run, outcome, failure?.code);
    if (notification && this.dependencies.notifications) {
      try {
        await this.dependencies.notifications.send(context.scope, notification);
        notificationDelivered = true;
      } catch {
        const warning = "scheduled run notification delivery failed";
        warnings.push(warning);
        this.warn(warning);
      }
    }

    return { telemetryDelivered, notificationDelivered, warnings };
  }
}
