import { ScheduledRunOutcomeReporter, type OwnershipScope } from "@automation/core";
import { AwsCloudWatchEmfTelemetryPort, type CloudWatchEmfLogSink } from "./cloudwatch-telemetry.js";
import {
  AwsSesNotificationPort,
  type SesRecipientResolver,
} from "./ses-notification.js";
import { AwsSesV2SendEmailTransport, type SesV2CommandSender } from "./ses-sdk.js";

const SES_FROM_EMAIL_ENV = "AUTOMATION_SES_FROM_EMAIL";
const CLOUDWATCH_NAMESPACE_ENV = "AUTOMATION_CLOUDWATCH_NAMESPACE";
const CLOUDWATCH_SERVICE_ENV = "AUTOMATION_CLOUDWATCH_SERVICE";

const DEFAULT_CLOUDWATCH_NAMESPACE = "AutomationPlatform";
const DEFAULT_CLOUDWATCH_SERVICE = "scheduled-run";

export type AwsScheduledReportingNotificationState =
  | { kind: "CONFIGURED" }
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] };

export interface AwsScheduledRunReportingComposition {
  reporter: ScheduledRunOutcomeReporter;
  notifications: AwsScheduledReportingNotificationState;
}

export interface AwsScheduledRunReportingCompositionOptions {
  env: Readonly<Record<string, string | undefined>>;
  recipients?: SesRecipientResolver;
  sesSender?: SesV2CommandSender;
  telemetrySink?: CloudWatchEmfLogSink;
  warn?: (message: string) => void;
  now?: () => Date;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function awsRegion(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return nonEmpty(env.AWS_REGION) ?? nonEmpty(env.AWS_DEFAULT_REGION);
}

/**
 * Composes best-effort scheduled-run reporting from deployment configuration.
 *
 * Telemetry is always available through EMF logging. Email remains explicitly
 * NOT_CONFIGURED until a sender identity, AWS region and trusted user-email
 * resolver all exist. Missing email configuration never disables telemetry or
 * execution.
 */
export function createAwsScheduledRunReporting(
  options: AwsScheduledRunReportingCompositionOptions,
): AwsScheduledRunReportingComposition {
  const namespace = nonEmpty(options.env[CLOUDWATCH_NAMESPACE_ENV]) ?? DEFAULT_CLOUDWATCH_NAMESPACE;
  const service = nonEmpty(options.env[CLOUDWATCH_SERVICE_ENV]) ?? DEFAULT_CLOUDWATCH_SERVICE;
  const telemetry = new AwsCloudWatchEmfTelemetryPort(
    { namespace, service },
    options.telemetrySink,
  );

  const fromEmail = nonEmpty(options.env[SES_FROM_EMAIL_ENV]);
  const region = awsRegion(options.env);
  const missing: string[] = [];
  if (!fromEmail) missing.push(SES_FROM_EMAIL_ENV);
  if (!region) missing.push("AWS_REGION (or AWS_DEFAULT_REGION)");
  if (!options.recipients) missing.push("trusted SesRecipientResolver");

  if (missing.length > 0 || !fromEmail || !region || !options.recipients) {
    return {
      reporter: new ScheduledRunOutcomeReporter({
        telemetry,
        ...(options.warn ? { warn: options.warn } : {}),
        ...(options.now ? { now: options.now } : {}),
      }),
      notifications: { kind: "NOT_CONFIGURED", missing },
    };
  }

  const notifications = new AwsSesNotificationPort(
    { fromEmail },
    new AwsSesV2SendEmailTransport(region, options.sesSender),
    options.recipients,
  );

  return {
    reporter: new ScheduledRunOutcomeReporter({
      telemetry,
      notifications,
      ...(options.warn ? { warn: options.warn } : {}),
      ...(options.now ? { now: options.now } : {}),
    }),
    notifications: { kind: "CONFIGURED" },
  };
}

/** Helper for deployment-owned recipient resolvers to fail closed on scope drift. */
export function assertNotificationRecipientScope(
  scope: OwnershipScope,
  recipientUserId: string,
): void {
  if (scope.userId !== recipientUserId) {
    throw new Error("notification recipient is outside trusted ownership scope");
  }
}
