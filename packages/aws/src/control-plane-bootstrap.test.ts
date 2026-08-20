import { describe, expect, it } from "vitest";
import { createAwsControlPlaneBootstrap } from "./control-plane-bootstrap.js";

const configuredEnv = {
  AWS_REGION: "us-east-1",
  AWS_DYNAMODB_TABLE: "automation-prod-state",
  AWS_ARTIFACT_BUCKET: "automation-prod-artifacts",
  AWS_COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
  AWS_COGNITO_APP_CLIENT_ID: "web-client-id",
  AUTOMATION_TENANT_ID: "tenant-prod",
  AWS_AGENTCORE_RUNTIME_ARN: "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/automation-runtime",
  AWS_SCHEDULE_DISPATCH_QUEUE_ARN: "arn:aws:sqs:us-east-1:123456789012:automation-dispatch",
  AWS_SCHEDULE_DISPATCH_DLQ_ARN: "arn:aws:sqs:us-east-1:123456789012:automation-dispatch-dlq",
  AWS_SCHEDULER_TARGET_ROLE_ARN: "arn:aws:iam::123456789012:role/automation-scheduler-target",
  AWS_SCHEDULER_GROUP_NAME: "automation-prod",
  AWS_SCHEDULED_RUN_STATE_MACHINE_ARN: "arn:aws:states:us-east-1:123456789012:stateMachine:automation-scheduled-run",
} as const;

describe("createAwsControlPlaneBootstrap", () => {
  it("fails closed and aggregates the production control-plane deployment contract", () => {
    const result = createAwsControlPlaneBootstrap({ env: {} });
    expect(result.kind).toBe("NOT_CONFIGURED");
    if (result.kind !== "NOT_CONFIGURED") {
      throw new Error("test bootstrap unexpectedly configured");
    }
    expect(result.missing).toEqual(expect.arrayContaining([
      "AWS_REGION (or AWS_DEFAULT_REGION)",
      "AWS_REGION",
      "AWS_DYNAMODB_TABLE",
      "AWS_ARTIFACT_BUCKET",
      "AWS_COGNITO_ISSUER",
      "AWS_COGNITO_APP_CLIENT_ID",
      "AUTOMATION_TENANT_ID",
      "AWS_AGENTCORE_RUNTIME_ARN",
      "AWS_SCHEDULE_DISPATCH_QUEUE_ARN",
      "AWS_SCHEDULE_DISPATCH_DLQ_ARN",
      "AWS_SCHEDULER_TARGET_ROLE_ARN",
      "AWS_SCHEDULER_GROUP_NAME",
      "AWS_SCHEDULED_RUN_STATE_MACHINE_ARN",
    ]));
  });

  it("constructs the cloud-backed service graph without live credentials or network calls", () => {
    const result = createAwsControlPlaneBootstrap({ env: configuredEnv });
    expect(result.kind).toBe("CONFIGURED");
    if (result.kind !== "CONFIGURED") {
      throw new Error("test bootstrap is not configured");
    }

    expect(result.configuration).toEqual({
      region: "us-east-1",
      tableName: "automation-prod-state",
      artifactBucket: "automation-prod-artifacts",
      browserIdentifier: "aws.browser.v1",
      runtimeArn: configuredEnv.AWS_AGENTCORE_RUNTIME_ARN,
      schedulerGroupName: "automation-prod",
    });
    expect(result.capabilities).toEqual({
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "NOT_CONFIGURED",
    });
    expect(result.service).toBeDefined();
    expect(result.http).toBeDefined();
    expect(result.lambda.kind).toBe("CONFIGURED");
    expect(result.captureCompletion).toBeDefined();
  });

  it("advertises notifications only when both sender and trusted user directory are configured", () => {
    const result = createAwsControlPlaneBootstrap({
      env: {
        ...configuredEnv,
        AUTOMATION_SES_FROM_EMAIL: "runs@example.com",
        AUTOMATION_COGNITO_USER_POOL_ID: "us-east-1_example",
      },
    });
    expect(result.kind).toBe("CONFIGURED");
    if (result.kind !== "CONFIGURED") {
      throw new Error("test bootstrap is not configured");
    }
    expect(result.capabilities.notifications).toBe("CONFIGURED");
  });

  it("rejects malformed AgentCore Runtime configuration before constructing the service", () => {
    expect(() => createAwsControlPlaneBootstrap({
      env: {
        ...configuredEnv,
        AWS_AGENTCORE_RUNTIME_ARN: "not-an-arn",
      },
    })).toThrow("AWS_AGENTCORE_RUNTIME_ARN must be an ARN");
  });
});
