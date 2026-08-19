import { createHash } from "node:crypto";
import type { AutomationSchedule } from "@automation/contracts";
import type {
  OwnershipScope,
  ScheduleRegistration,
  SchedulerPort,
  ScheduledDispatchEnvelope,
  ScheduledExecutionStarter,
  ScheduledExecutionStartResult,
} from "@automation/core";
import { ScheduledDispatchService } from "@automation/core";

export interface AwsSchedulerTargetConfig {
  queueArn: string;
  schedulerRoleArn: string;
  deadLetterQueueArn: string;
  groupName?: string;
  maximumEventAgeInSeconds?: number;
  maximumRetryAttempts?: number;
}

export interface AwsSchedulerDefinition {
  name: string;
  groupName?: string;
  scheduleExpression: string;
  scheduleExpressionTimezone: string;
  state: "ENABLED" | "DISABLED";
  target: {
    arn: string;
    roleArn: string;
    input: string;
    deadLetterArn: string;
    maximumEventAgeInSeconds: number;
    maximumRetryAttempts: number;
  };
}

export interface AwsSchedulerApi {
  get(name: string, groupName?: string): Promise<AwsSchedulerDefinition | null>;
  create(definition: AwsSchedulerDefinition): Promise<void>;
  update(definition: AwsSchedulerDefinition): Promise<void>;
  delete(name: string, groupName?: string): Promise<void>;
}

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function scheduleName(scope: OwnershipScope, scheduleId: string): string {
  const digest = createHash("sha256")
    .update(`${scope.tenantId}\u0000${scope.userId}\u0000${scheduleId}`)
    .digest("hex")
    .slice(0, 48);
  return `automation-${digest}`;
}

function assertAwsScheduleExpression(expression: string): string {
  const value = nonEmpty(expression, "schedule expression");
  if (!/^(rate|cron)\(.+\)$/.test(value)) {
    throw new Error("AWS schedule expression must use rate(...) or cron(...)");
  }
  return value;
}

function isScheduleKind(value: unknown): value is AutomationSchedule["kind"] {
  return value === "HOURLY" || value === "DAILY" || value === "WEEKLY" || value === "CRON";
}

export class AwsEventBridgeSchedulerAdapter implements SchedulerPort {
  private readonly maximumEventAgeInSeconds: number;
  private readonly maximumRetryAttempts: number;

  constructor(
    private readonly api: AwsSchedulerApi,
    private readonly target: AwsSchedulerTargetConfig,
  ) {
    this.maximumEventAgeInSeconds = target.maximumEventAgeInSeconds ?? 3600;
    this.maximumRetryAttempts = target.maximumRetryAttempts ?? 5;
    if (this.maximumEventAgeInSeconds < 60 || this.maximumEventAgeInSeconds > 86400) {
      throw new Error("scheduler maximum event age must be between 60 and 86400 seconds");
    }
    if (this.maximumRetryAttempts < 0 || this.maximumRetryAttempts > 185) {
      throw new Error("scheduler maximum retry attempts must be between 0 and 185");
    }
    nonEmpty(target.queueArn, "queueArn");
    nonEmpty(target.schedulerRoleArn, "schedulerRoleArn");
    nonEmpty(target.deadLetterQueueArn, "deadLetterQueueArn");
  }

  async upsert(scope: OwnershipScope, registration: ScheduleRegistration): Promise<void> {
    const name = scheduleName(scope, nonEmpty(registration.scheduleId, "scheduleId"));
    const envelope: ScheduledDispatchEnvelope = {
      schemaVersion: 1,
      scope: { ...scope },
      automationId: nonEmpty(registration.automationId, "automationId"),
      scheduleId: registration.scheduleId,
      scheduledAt: "<aws.scheduler.scheduled-time>",
      deliveryId: "<aws.scheduler.execution-id>",
    };
    const definition: AwsSchedulerDefinition = {
      name,
      ...(this.target.groupName ? { groupName: this.target.groupName } : {}),
      scheduleExpression: assertAwsScheduleExpression(registration.schedule.expression),
      scheduleExpressionTimezone: nonEmpty(registration.schedule.timezone, "schedule timezone"),
      state: registration.enabled ? "ENABLED" : "DISABLED",
      target: {
        arn: this.target.queueArn,
        roleArn: this.target.schedulerRoleArn,
        input: JSON.stringify({ ...envelope, scheduleKind: registration.schedule.kind }),
        deadLetterArn: this.target.deadLetterQueueArn,
        maximumEventAgeInSeconds: this.maximumEventAgeInSeconds,
        maximumRetryAttempts: this.maximumRetryAttempts,
      },
    };
    const existing = await this.api.get(name, this.target.groupName);
    if (existing) await this.api.update(definition);
    else await this.api.create(definition);
  }

  async delete(scope: OwnershipScope, scheduleId: string): Promise<void> {
    const name = scheduleName(scope, nonEmpty(scheduleId, "scheduleId"));
    if (await this.api.get(name, this.target.groupName)) {
      await this.api.delete(name, this.target.groupName);
    }
  }

  async get(scope: OwnershipScope, scheduleId: string): Promise<ScheduleRegistration | null> {
    const name = scheduleName(scope, nonEmpty(scheduleId, "scheduleId"));
    const definition = await this.api.get(name, this.target.groupName);
    if (!definition) return null;
    const persisted = JSON.parse(definition.target.input) as Partial<ScheduledDispatchEnvelope> & { scheduleKind?: unknown };
    if (persisted.schemaVersion !== 1 || persisted.scope?.tenantId !== scope.tenantId || persisted.scope.userId !== scope.userId) {
      throw new Error("persisted AWS schedule ownership does not match scope");
    }
    if (typeof persisted.automationId !== "string") throw new Error("persisted AWS schedule automation identity is invalid");
    if (!isScheduleKind(persisted.scheduleKind)) throw new Error("persisted AWS schedule kind is invalid");
    return {
      scheduleId,
      automationId: persisted.automationId,
      schedule: {
        kind: persisted.scheduleKind,
        expression: definition.scheduleExpression,
        timezone: definition.scheduleExpressionTimezone,
      },
      enabled: definition.state === "ENABLED",
    };
  }
}

export interface AwsStepFunctionsApi {
  startExecution(input: { stateMachineArn: string; name: string; input: string }): Promise<{ executionArn: string }>;
}

export class AwsStepFunctionsScheduledExecutionStarter implements ScheduledExecutionStarter {
  constructor(
    private readonly api: AwsStepFunctionsApi,
    private readonly stateMachineArn: string,
  ) {
    nonEmpty(stateMachineArn, "stateMachineArn");
  }

  async start(envelope: ScheduledDispatchEnvelope): Promise<ScheduledExecutionStartResult> {
    const occurrenceHash = createHash("sha256")
      .update(`${envelope.scope.tenantId}\u0000${envelope.scope.userId}\u0000${envelope.automationId}\u0000${envelope.scheduledAt}`)
      .digest("hex");
    const name = `scheduled-${occurrenceHash}`;
    try {
      const started = await this.api.startExecution({
        stateMachineArn: this.stateMachineArn,
        name,
        input: JSON.stringify(envelope),
      });
      return { kind: "STARTED", executionRef: started.executionArn };
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "ExecutionAlreadyExists") {
        return { kind: "DUPLICATE", executionRef: `${this.stateMachineArn}:${name}` };
      }
      throw error;
    }
  }
}

export interface AwsSqsRecord {
  messageId: string;
  body: string;
}

export interface AwsSqsEvent {
  Records: readonly AwsSqsRecord[];
}

export interface AwsSqsBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

export class AwsSqsScheduledDispatchHandler {
  private readonly service: ScheduledDispatchService;

  constructor(starter: ScheduledExecutionStarter) {
    this.service = new ScheduledDispatchService(starter);
  }

  async handle(event: AwsSqsEvent): Promise<AwsSqsBatchResponse> {
    const failures: Array<{ itemIdentifier: string }> = [];
    for (const record of event.Records) {
      try {
        await this.service.handle(JSON.parse(record.body));
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  }
}
