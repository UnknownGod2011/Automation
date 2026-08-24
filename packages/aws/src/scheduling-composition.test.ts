import {
  CreateScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { describe, expect, it, vi } from "vitest";
import {
  AwsSdkSchedulerApi,
  AwsSdkStepFunctionsApi,
  createAwsSchedulingComposition,
  loadAwsSchedulingDeploymentConfig,
} from "./scheduling-composition.js";
import type { AwsSchedulerDefinition } from "./scheduling-dispatch.js";

const definition: AwsSchedulerDefinition = {
  name: "automation-abc",
  groupName: "automation-prod",
  scheduleExpression: "cron(0 9 ? * MON-FRI *)",
  scheduleExpressionTimezone: "Asia/Kolkata",
  state: "ENABLED",
  target: {
    arn: "arn:aws:sqs:ap-south-1:123456789012:dispatch",
    roleArn: "arn:aws:iam::123456789012:role/scheduler",
    input: "{\"schemaVersion\":1}",
    deadLetterArn: "arn:aws:sqs:ap-south-1:123456789012:dispatch-dlq",
    maximumEventAgeInSeconds: 3600,
    maximumRetryAttempts: 5,
  },
};

const configuredEnv = {
  AWS_REGION: "ap-south-1",
  AWS_SCHEDULE_DISPATCH_QUEUE_ARN: definition.target.arn,
  AWS_SCHEDULE_DISPATCH_DLQ_ARN: definition.target.deadLetterArn,
  AWS_SCHEDULER_TARGET_ROLE_ARN: definition.target.roleArn,
  AWS_SCHEDULER_GROUP_NAME: definition.groupName!,
  AWS_SCHEDULED_RUN_STATE_MACHINE_ARN: "arn:aws:states:ap-south-1:123456789012:stateMachine:automation-prod",
} as const;

describe("AWS scheduling deployment composition", () => {
  it("reports a fail-closed NOT_CONFIGURED-style result without constructing partial deployment state", () => {
    expect(loadAwsSchedulingDeploymentConfig({ AWS_REGION: "ap-south-1" })).toEqual({
      configured: false,
      missing: [
        "AWS_SCHEDULE_DISPATCH_QUEUE_ARN",
        "AWS_SCHEDULE_DISPATCH_DLQ_ARN",
        "AWS_SCHEDULER_TARGET_ROLE_ARN",
        "AWS_SCHEDULER_GROUP_NAME",
        "AWS_SCHEDULED_RUN_STATE_MACHINE_ARN",
      ],
      message: "AWS scheduling is not configured: missing AWS_SCHEDULE_DISPATCH_QUEUE_ARN, AWS_SCHEDULE_DISPATCH_DLQ_ARN, AWS_SCHEDULER_TARGET_ROLE_ARN, AWS_SCHEDULER_GROUP_NAME, AWS_SCHEDULED_RUN_STATE_MACHINE_ARN",
    });
    expect(createAwsSchedulingComposition({})).toMatchObject({ configured: false });
  });

  it("maps the IaC output environment contract into concrete SDK-backed adapters", () => {
    const loaded = loadAwsSchedulingDeploymentConfig(configuredEnv);
    expect(loaded).toEqual({ configured: true, config: {
      region: "ap-south-1",
      queueArn: definition.target.arn,
      deadLetterQueueArn: definition.target.deadLetterArn,
      schedulerRoleArn: definition.target.roleArn,
      schedulerGroupName: "automation-prod",
      stateMachineArn: configuredEnv.AWS_SCHEDULED_RUN_STATE_MACHINE_ARN,
    } });
    const result = createAwsSchedulingComposition(configuredEnv);
    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("expected configured composition");
    expect(result.composition.schedulerApi).toBeInstanceOf(AwsSdkSchedulerApi);
    expect(result.composition.stepFunctionsApi).toBeInstanceOf(AwsSdkStepFunctionsApi);
  });

  it("translates the narrow scheduler definition to official SDK commands and validates read-back", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof CreateScheduleCommand) return {};
      if (command instanceof GetScheduleCommand) {
        return {
          Name: definition.name,
          GroupName: definition.groupName,
          ScheduleExpression: definition.scheduleExpression,
          ScheduleExpressionTimezone: definition.scheduleExpressionTimezone,
          State: definition.state,
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
      throw new Error("unexpected command");
    });
    const api = new AwsSdkSchedulerApi({ send } as unknown as SchedulerClient);

    await api.create(definition);
    const create = send.mock.calls[0]?.[0];
    expect(create).toBeInstanceOf(CreateScheduleCommand);
    if (!(create instanceof CreateScheduleCommand)) throw new Error("expected create command");
    expect(create.input.FlexibleTimeWindow).toEqual({ Mode: "OFF" });
    expect(create.input.Target?.RetryPolicy).toEqual({
      MaximumEventAgeInSeconds: 3600,
      MaximumRetryAttempts: 5,
    });
    await expect(api.get(definition.name, definition.groupName)).resolves.toEqual(definition);
  });

  it("classifies Scheduler resource absence but propagates uncertain provider failures", async () => {
    const notFound = new AwsSdkSchedulerApi({
      send: vi.fn(async () => { throw Object.assign(new Error("not found"), { name: "ResourceNotFoundException" }); }),
    } as unknown as SchedulerClient);
    await expect(notFound.get("missing", "automation-prod")).resolves.toBeNull();

    const uncertain = new AwsSdkSchedulerApi({
      send: vi.fn(async () => { throw Object.assign(new Error("throttled"), { name: "ThrottlingException" }); }),
    } as unknown as SchedulerClient);
    await expect(uncertain.get("unknown", "automation-prod")).rejects.toMatchObject({ name: "ThrottlingException" });
  });

  it("uses the official Step Functions client boundary and rejects malformed provider responses", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(StartExecutionCommand);
      return { executionArn: "arn:aws:states:ap-south-1:123456789012:execution:automation-prod:run-1" };
    });
    const api = new AwsSdkStepFunctionsApi({ send } as unknown as SFNClient);
    await expect(api.startExecution({
      stateMachineArn: configuredEnv.AWS_SCHEDULED_RUN_STATE_MACHINE_ARN,
      name: "run-1",
      input: "{}",
    })).resolves.toEqual({ executionArn: "arn:aws:states:ap-south-1:123456789012:execution:automation-prod:run-1" });

    const malformed = new AwsSdkStepFunctionsApi({
      send: vi.fn(async () => ({})),
    } as unknown as SFNClient);
    await expect(malformed.startExecution({
      stateMachineArn: configuredEnv.AWS_SCHEDULED_RUN_STATE_MACHINE_ARN,
      name: "run-2",
      input: "{}",
    })).rejects.toThrow("AWS Step Functions response executionArn is invalid");
  });
});
