import { ScheduledRunOutcomeReporter, type OwnershipScope } from "@automation/core";
import { AwsCloudWatchEmfTelemetryPort, type CloudWatchEmfLogSink } from "./cloudwatch-telemetry.js";
import {
  createAwsCognitoUserEmailResolver,
  type CognitoListUsersSender,
} from "./cognito-user-email.js";
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
  /** Explicit resolver override for tests or non-Cognito deployments. */
  recipients?: SesRecipientResolver;
  /** Optional Cognito sender override; production defaults to the AWS SDK client. */
  cognitoUsers?: CognitoListUsersSender;
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
 * Telemetry is always available through EMF logging. Email becomes configured
 * only when a sender identity, AWS region, and trusted recipient resolver exist.
 * Production may derive that resolver from the configured Cognito user pool;
 * the scheduled payload still never supplies an email address.
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
  const cognito = createAwsCognitoUserEmailResolver(options.env, options.cognitoUsers);
  const recipients = options.recipients ?? (cognito.configured ? cognito.resolver : undefined);
  const missing: string[] = [];
  if (!fromEmail) missing.push(SES_FROM_EMAIL_ENV);
  if (!region) missing.push("AWS_REGION (or AWS_DEFAULT_REGION)");
  if (!recipients) {
    if (!cognito.configured) missing.push(...cognito.missing);
    else missing.push("trusted SesRecipientResolver");
  }

  if (missing.length > 0 || !fromEmail || !region || !recipients) {
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
    recipients,
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
