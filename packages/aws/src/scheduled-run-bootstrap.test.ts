import { describe, expect, it } from "vitest";
import { createAwsScheduledRunBootstrap } from "./scheduled-run-bootstrap.js";

const configuredEnv = {
  AWS_REGION: "us-east-1",
  AWS_DYNAMODB_TABLE: "automation-prod-state",
  AWS_ARTIFACT_BUCKET: "automation-prod-artifacts",
  OPENAI_BYOK_MODEL: "gpt-5-mini",
} as const;

describe("createAwsScheduledRunBootstrap", () => {
  it("fails closed and aggregates mandatory deployment configuration", () => {
    expect(createAwsScheduledRunBootstrap({ env: {} })).toEqual({
      kind: "NOT_CONFIGURED",
      missing: [
        "AWS_REGION (or AWS_DEFAULT_REGION)",
        "AWS_DYNAMODB_TABLE",
        "AWS_ARTIFACT_BUCKET",
        "OPENAI_BYOK_MODEL",
      ],
    });
  });

  it("constructs the production worker graph without requiring live AWS credentials", () => {
    const result = createAwsScheduledRunBootstrap({
      env: {
        ...configuredEnv,
        AWS_AGENTCORE_BROWSER_IDENTIFIER: "browser-prod",
        AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS: "1800",
      },
    });
    expect(result.kind).toBe("CONFIGURED");
    if (result.kind !== "CONFIGURED") {
      throw new Error("test bootstrap is not configured");
    }

    expect(result.configuration).toEqual({
      region: "us-east-1",
      tableName: "automation-prod-state",
      artifactBucket: "automation-prod-artifacts",
      browserIdentifier: "browser-prod",
      openAiModel: "gpt-5-mini",
    });
    expect(result.handler).toBeDefined();
    expect(result.notifications).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AUTOMATION_SES_FROM_EMAIL", "AUTOMATION_COGNITO_USER_POOL_ID"],
    });
  });

  it("keeps optional email configuration independent from execution readiness", () => {
    const result = createAwsScheduledRunBootstrap({
      env: {
        ...configuredEnv,
        AUTOMATION_SES_FROM_EMAIL: "runs@example.com",
      },
    });
    expect(result.kind).toBe("CONFIGURED");
    if (result.kind !== "CONFIGURED") {
      throw new Error("test bootstrap is not configured");
    }
    expect(result.notifications).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AUTOMATION_COGNITO_USER_POOL_ID"],
    });
  });

  it("configures notification resolution when the Cognito user pool is wired", () => {
    const result = createAwsScheduledRunBootstrap({
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
    expect(result.notifications).toEqual({ kind: "CONFIGURED" });
  });

  it("rejects malformed adapter configuration instead of silently normalizing it", () => {
    expect(() =>
      createAwsScheduledRunBootstrap({
        env: {
          ...configuredEnv,
          AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS: "0",
        },
      }),
    ).toThrow("AWS_AGENTCORE_BROWSER_SESSION_TIMEOUT_SECONDS");
  });
});
