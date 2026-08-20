import type {
  RunTelemetryPort,
  ScheduledRunTelemetryEvent,
} from "@automation/core";

export interface CloudWatchEmfLogSink {
  write(serializedEvent: string): void;
}

export interface AwsCloudWatchEmfTelemetryConfiguration {
  namespace: string;
  service: string;
}

function boundedLabel(value: string, field: string, maxLength = 128): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`${field} must be between 1 and ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * Emits CloudWatch Embedded Metric Format JSON to stdout (or another injected
 * log sink). Lambda/AgentCore logging infrastructure can ingest this without a
 * CloudWatch SDK call. High-cardinality correlation identifiers are ordinary
 * structured fields, not metric dimensions, to avoid cardinality-driven cost.
 */
export class AwsCloudWatchEmfTelemetryPort implements RunTelemetryPort {
  private readonly namespace: string;
  private readonly service: string;
  private readonly sink: CloudWatchEmfLogSink;

  constructor(
    configuration: AwsCloudWatchEmfTelemetryConfiguration,
    sink: CloudWatchEmfLogSink = { write: (value) => console.log(value) },
  ) {
    this.namespace = boundedLabel(configuration.namespace, "CloudWatch namespace", 255);
    this.service = boundedLabel(configuration.service, "CloudWatch service");
    this.sink = sink;
  }

  async emit(event: ScheduledRunTelemetryEvent): Promise<void> {
    const timestamp = Date.parse(event.observedAt);
    if (!Number.isFinite(timestamp)) throw new Error("telemetry observedAt must be an ISO timestamp");

    const metricDefinitions: Array<{ Name: string; Unit: "Count" | "Milliseconds" }> = [
      { Name: "ScheduledRunCount", Unit: "Count" },
      { Name: "CleanupWarningCount", Unit: "Count" },
    ];
    if (event.durationMs !== undefined) {
      metricDefinitions.push({ Name: "RunDurationMs", Unit: "Milliseconds" });
    }

    const payload = {
      _aws: {
        Timestamp: timestamp,
        CloudWatchMetrics: [{
          Namespace: this.namespace,
          Dimensions: [["Service", "Outcome"]],
          Metrics: metricDefinitions,
        }],
      },
      Service: this.service,
      Outcome: event.outcome,
      ScheduledRunCount: 1,
      CleanupWarningCount: event.cleanupWarningCount,
      TenantId: event.tenantId,
      UserId: event.userId,
      AutomationId: event.automationId,
      RunId: event.runId,
      WorkflowVersion: event.workflowVersion,
      RunStatus: event.runStatus,
      ScheduledAt: event.scheduledAt,
      ObservedAt: event.observedAt,
      ...(event.durationMs !== undefined ? { RunDurationMs: event.durationMs } : {}),
      ...(event.nodeId ? { NodeId: event.nodeId } : {}),
      ...(event.failureCode ? { FailureCode: event.failureCode } : {}),
    };

    this.sink.write(JSON.stringify(payload));
  }
}
