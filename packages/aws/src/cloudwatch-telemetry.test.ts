import { describe, expect, it } from "vitest";
import { AwsCloudWatchEmfTelemetryPort } from "./cloudwatch-telemetry.js";

const event = {
  eventName: "scheduled_run_outcome" as const,
  observedAt: "2026-08-20T06:00:05.000Z",
  tenantId: "tenant-1",
  userId: "user-1",
  automationId: "auto-1",
  runId: "run-1",
  workflowVersion: 3,
  scheduledAt: "2026-08-20T06:00:00.000Z",
  runStatus: "FAILED" as const,
  outcome: "FAILED" as const,
  cleanupWarningCount: 1,
  durationMs: 2450,
  nodeId: "click-1",
  failureCode: "EFFECT_NOT_VERIFIED" as const,
};

describe("AwsCloudWatchEmfTelemetryPort", () => {
  it("emits CloudWatch EMF with low-cardinality metric dimensions and correlation fields", async () => {
    const lines: string[] = [];
    const telemetry = new AwsCloudWatchEmfTelemetryPort(
      { namespace: "AutomationPlatform", service: "scheduled-run" },
      { write(value) { lines.push(value); } },
    );

    await telemetry.emit(event);

    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0] ?? "{}") as {
      _aws?: { CloudWatchMetrics?: Array<{ Dimensions?: string[][] }> };
      TenantId?: string;
      RunId?: string;
      Outcome?: string;
      FailureCode?: string;
      RunDurationMs?: number;
    };
    expect(payload._aws?.CloudWatchMetrics?.[0]?.Dimensions).toEqual([["Service", "Outcome"]]);
    expect(payload).toMatchObject({
      TenantId: "tenant-1",
      RunId: "run-1",
      Outcome: "FAILED",
      FailureCode: "EFFECT_NOT_VERIFIED",
      RunDurationMs: 2450,
    });
    expect(lines[0]).not.toContain("cookie");
    expect(lines[0]).not.toContain("ownerToken");
  });

  it("rejects invalid configuration and timestamps before emitting", async () => {
    expect(() => new AwsCloudWatchEmfTelemetryPort({ namespace: "", service: "scheduled-run" }))
      .toThrow("CloudWatch namespace");
    const telemetry = new AwsCloudWatchEmfTelemetryPort(
      { namespace: "AutomationPlatform", service: "scheduled-run" },
      { write() { throw new Error("should not write"); } },
    );
    await expect(telemetry.emit({ ...event, observedAt: "not-a-date" }))
      .rejects.toThrow("observedAt");
  });
});
