import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  AwsEventBridgeSchedulerAdapter,
  AwsSqsScheduledDispatchHandler,
  AwsStepFunctionsScheduledExecutionStarter,
  type AwsSchedulerApi,
  type AwsSchedulerDefinition,
  type AwsStepFunctionsApi,
} from "./scheduling-dispatch.js";

export interface AwsSchedulingDeploymentConfig {
  region: string;
  queueArn: string;
  deadLetterQueueArn: string;
  schedulerRoleArn: string;
  schedulerGroupName: string;
  stateMachineArn: string;
}

export type AwsSchedulingDeploymentConfigResult =
  | { configured: true; config: AwsSchedulingDeploymentConfig }
  | { configured: false; missing: readonly string[]; message: string };

export interface AwsSchedulingComposition {
  config: AwsSchedulingDeploymentConfig;
  schedulerApi: AwsSchedulerApi;
  scheduler: AwsEventBridgeSchedulerAdapter;
  stepFunctionsApi: AwsStepFunctionsApi;
  executionStarter: AwsStepFunctionsScheduledExecutionStarter;
  dispatchHandler: AwsSqsScheduledDispatchHandler;
}

export type AwsSchedulingCompositionResult =
  | { configured: true; composition: AwsSchedulingComposition }
  | { configured: false; missing: readonly string[]; message: string };

interface SchedulerGetResponse {
  Name?: unknown;
  GroupName?: unknown;
  ScheduleExpression?: unknown;
  ScheduleExpressionTimezone?: unknown;
  State?: unknown;
  Target?: {
    Arn?: unknown;
    RoleArn?: unknown;
    Input?: unknown;
    DeadLetterConfig?: { Arn?: unknown };
    RetryPolicy?: {
      MaximumEventAgeInSeconds?: unknown;
      MaximumRetryAttempts?: unknown;
    };
  };
}

interface StepFunctionsStartResponse {
  executionArn?: unknown;
}

function nonEmptyEnv(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`AWS Scheduler response ${field} is invalid`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`AWS Scheduler response ${field} is invalid`);
  }
  return value as number;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "ResourceNotFoundException");
}

function toSchedulerDefinition(response: SchedulerGetResponse): AwsSchedulerDefinition {
  const target = response.Target;
  if (!target) throw new Error("AWS Scheduler response target is missing");
  const retryPolicy = target.RetryPolicy;
  if (!retryPolicy) throw new Error("AWS Scheduler response retry policy is missing");
  const state = response.State;
  if (state !== "ENABLED" && state !== "DISABLED") {
    throw new Error("AWS Scheduler response state is invalid");
  }
  return {
    name: requiredString(response.Name, "name"),
    ...(typeof response.GroupName === "string" && response.GroupName.trim() ? { groupName: response.GroupName } : {}),
    scheduleExpression: requiredString(response.ScheduleExpression, "scheduleExpression"),
    scheduleExpressionTimezone: requiredString(response.ScheduleExpressionTimezone, "scheduleExpressionTimezone"),
    state,
    target: {
      arn: requiredString(target.Arn, "target.arn"),
      roleArn: requiredString(target.RoleArn, "target.roleArn"),
      input: requiredString(target.Input, "target.input"),
      deadLetterArn: requiredString(target.DeadLetterConfig?.Arn, "target.deadLetterArn"),
      maximumEventAgeInSeconds: requiredInteger(retryPolicy.MaximumEventAgeInSeconds, "target.maximumEventAgeInSeconds"),
      maximumRetryAttempts: requiredInteger(retryPolicy.MaximumRetryAttempts, "target.maximumRetryAttempts"),
    },
  };
}

function schedulerCommandInput(definition: AwsSchedulerDefinition) {
  return {
    Name: definition.name,
    ...(definition.groupName ? { GroupName: definition.groupName } : {}),
    ScheduleExpression: definition.scheduleExpression,
    ScheduleExpressionTimezone: definition.scheduleExpressionTimezone,
    State: definition.state,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: {
      Arn: definition.target.arn,
      RoleArn: definition.target.roleArn,
      Input: definition.target.input,
      DeadLetterConfig: { Arn: definition.target.deadLetterArn },
      RetryPolicy: {
        MaximumEventAgeInSeconds: definition.target.maximumEventAgeInSeconds,
        MaximumRetryAttempts: definition.target.maximumRetryAttempts,
      },
    },
  };
}

export class AwsSdkSchedulerApi implements AwsSchedulerApi {
  constructor(private readonly client: SchedulerClient) {}

  async get(name: string, groupName?: string): Promise<AwsSchedulerDefinition | null> {
    try {
      const response = await this.client.send(new GetScheduleCommand({
        Name: name,
        ...(groupName ? { GroupName: groupName } : {}),
      }));
      return toSchedulerDefinition(response);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async create(definition: AwsSchedulerDefinition): Promise<void> {
    await this.client.send(new CreateScheduleCommand(schedulerCommandInput(definition)));
  }

  async update(definition: AwsSchedulerDefinition): Promise<void> {
    await this.client.send(new UpdateScheduleCommand(schedulerCommandInput(definition)));
  }

  async delete(name: string, groupName?: string): Promise<void> {
    try {
      await this.client.send(new DeleteScheduleCommand({
        Name: name,
        ...(groupName ? { GroupName: groupName } : {}),
      }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

export class AwsSdkStepFunctionsApi implements AwsStepFunctionsApi {
  constructor(private readonly client: SFNClient) {}

  async startExecution(input: { stateMachineArn: string; name: string; input: string }): Promise<{ executionArn: string }> {
    const response: StepFunctionsStartResponse = await this.client.send(new StartExecutionCommand(input));
    if (typeof response.executionArn !== "string" || response.executionArn.trim() === "") {
      throw new Error("AWS Step Functions response executionArn is invalid");
    }
    return { executionArn: response.executionArn };
  }
}

export function loadAwsSchedulingDeploymentConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsSchedulingDeploymentConfigResult {
  const values = {
    region: nonEmptyEnv(env, "AWS_REGION") ?? nonEmptyEnv(env, "AWS_DEFAULT_REGION"),
    queueArn: nonEmptyEnv(env, "AWS_SCHEDULE_DISPATCH_QUEUE_ARN"),
    deadLetterQueueArn: nonEmptyEnv(env, "AWS_SCHEDULE_DISPATCH_DLQ_ARN"),
    schedulerRoleArn: nonEmptyEnv(env, "AWS_SCHEDULER_TARGET_ROLE_ARN"),
    schedulerGroupName: nonEmptyEnv(env, "AWS_SCHEDULER_GROUP_NAME"),
    stateMachineArn: nonEmptyEnv(env, "AWS_SCHEDULED_RUN_STATE_MACHINE_ARN"),
  };
  const missing: string[] = [];
  if (!values.region) missing.push("AWS_REGION (or AWS_DEFAULT_REGION)");
  if (!values.queueArn) missing.push("AWS_SCHEDULE_DISPATCH_QUEUE_ARN");
  if (!values.deadLetterQueueArn) missing.push("AWS_SCHEDULE_DISPATCH_DLQ_ARN");
  if (!values.schedulerRoleArn) missing.push("AWS_SCHEDULER_TARGET_ROLE_ARN");
  if (!values.schedulerGroupName) missing.push("AWS_SCHEDULER_GROUP_NAME");
  if (!values.stateMachineArn) missing.push("AWS_SCHEDULED_RUN_STATE_MACHINE_ARN");
  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      message: `AWS scheduling is not configured: missing ${missing.join(", ")}`,
    };
  }
  return {
    configured: true,
    config: values as AwsSchedulingDeploymentConfig,
  };
}

export function createAwsSchedulingComposition(
  env: Readonly<Record<string, string | undefined>>,
): AwsSchedulingCompositionResult {
  const loaded = loadAwsSchedulingDeploymentConfig(env);
  if (!loaded.configured) return loaded;
  const config = loaded.config;
  const schedulerClient = new SchedulerClient({ region: config.region });
  const stepFunctionsClient = new SFNClient({ region: config.region });
  const schedulerApi = new AwsSdkSchedulerApi(schedulerClient);
  const stepFunctionsApi = new AwsSdkStepFunctionsApi(stepFunctionsClient);
  const executionStarter = new AwsStepFunctionsScheduledExecutionStarter(stepFunctionsApi, config.stateMachineArn);
  return {
    configured: true,
    composition: {
      config,
      schedulerApi,
      scheduler: new AwsEventBridgeSchedulerAdapter(schedulerApi, {
        queueArn: config.queueArn,
        deadLetterQueueArn: config.deadLetterQueueArn,
        schedulerRoleArn: config.schedulerRoleArn,
        groupName: config.schedulerGroupName,
      }),
      stepFunctionsApi,
      executionStarter,
      dispatchHandler: new AwsSqsScheduledDispatchHandler(executionStarter),
    },
  };
}
