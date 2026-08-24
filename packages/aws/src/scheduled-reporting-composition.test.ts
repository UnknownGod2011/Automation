import type { AutomationRecord, RunRecord } from "@automation/contracts";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import { createAwsScheduledRunReporting } from "./scheduled-reporting-composition.js";
import type { CognitoListUsersSender } from "./cognito-user-email.js";

const scope = { tenantId: "tenant-1", userId: "user-1" } as const;
const observedAt = "2026-08-20T08:00:00.000Z";
const automation: AutomationRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Daily workflow",
  websiteUrl: "https://example.com",
  prompt: "Do the task",
  status: "ACTIVE",
  publishedWorkflowVersion: 1,
  browserProfileRef: "profile-1",
  notifyOnSuccess: true,
  notifyOnFailure: true,
  createdAt: observedAt,
  updatedAt: observedAt,
};
const run: RunRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  runId: "run-1",
  automationId: automation.automationId,
  workflowVersion: 1,
  occurrenceKey: "auto-1:2026-08-20T07:59:00.000Z",
  status: "WAITING_FOR_HUMAN",
  scheduledAt: "2026-08-20T07:59:00.000Z",
  currentNodeId: "node-1",
};
const result = {
  kind: "NOT_RUN" as const,
  preparation: { kind: "BLOCKED" as const, run },
  cleanupWarnings: [] as const,
};

describe("createAwsScheduledRunReporting", () => {
  it("keeps telemetry available while exposing email as NOT_CONFIGURED", async () => {
    const telemetry: string[] = [];
    const composition = createAwsScheduledRunReporting({
      env: {},
      telemetrySink: { write(value) { telemetry.push(value); } },
      now: () => new Date(observedAt),
    });

    expect(composition.notifications).toEqual({
      kind: "NOT_CONFIGURED",
      missing: [
        "AUTOMATION_SES_FROM_EMAIL",
        "AWS_REGION (or AWS_DEFAULT_REGION)",
        "AUTOMATION_COGNITO_USER_POOL_ID",
      ],
    });
    const report = await composition.reporter.report({ scope, automation, result });
    expect(report.telemetryDelivered).toBe(true);
    expect(report.notificationDelivered).toBe(false);
    expect(telemetry).toHaveLength(1);
  });

  it("sends configured notifications through SES v2 using an explicit trusted resolver", async () => {
    const commands: SendEmailCommand[] = [];
    const composition = createAwsScheduledRunReporting({
      env: {
        AWS_REGION: "ap-south-1",
        AUTOMATION_SES_FROM_EMAIL: "automation@example.com",
      },
      recipients: {
        async resolve(observedScope, userId) {
          expect(observedScope).toEqual(scope);
          expect(userId).toBe(scope.userId);
          return { email: "owner@example.com" };
        },
      },
      sesSender: {
        async send(command) {
          commands.push(command);
          return {};
        },
      },
      telemetrySink: { write() {} },
      now: () => new Date(observedAt),
    });

    expect(composition.notifications).toEqual({ kind: "CONFIGURED" });
    const report = await composition.reporter.report({ scope, automation, result });
    expect(report.notificationDelivered).toBe(true);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.input.Destination?.ToAddresses).toEqual(["owner@example.com"]);
    expect(commands[0]?.input.FromEmailAddress).toBe("automation@example.com");
  });

  it("derives the production recipient from the configured Cognito user pool", async () => {
    const commands: SendEmailCommand[] = [];
    const cognitoUsers = {
      send: vi.fn(async () => ({
        Users: [{
          Enabled: true,
          Attributes: [
            { Name: "sub", Value: scope.userId },
            { Name: "email", Value: "owner@example.com" },
            { Name: "email_verified", Value: "true" },
          ],
        }],
        $metadata: {},
      })),
    } satisfies CognitoListUsersSender;
    const composition = createAwsScheduledRunReporting({
      env: {
        AWS_REGION: "ap-south-1",
        AUTOMATION_SES_FROM_EMAIL: "automation@example.com",
        AUTOMATION_COGNITO_USER_POOL_ID: "ap-south-1_example",
      },
      cognitoUsers,
      sesSender: {
        async send(command) {
          commands.push(command);
          return {};
        },
      },
      telemetrySink: { write() {} },
      now: () => new Date(observedAt),
    });

    expect(composition.notifications).toEqual({ kind: "CONFIGURED" });
    const report = await composition.reporter.report({ scope, automation, result });
    expect(report.notificationDelivered).toBe(true);
    expect(cognitoUsers.send).toHaveBeenCalledTimes(1);
    expect(commands[0]?.input.Destination?.ToAddresses).toEqual(["owner@example.com"]);
  });
});
