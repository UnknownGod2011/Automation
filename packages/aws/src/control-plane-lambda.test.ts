import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "@automation/core";
import {
  createAwsControlPlaneLambdaHandler,
  type ApiGatewayHttpApiV2Event,
  type ControlPlaneHttpHandlerLike,
} from "./control-plane-lambda.js";

const env = {
  AWS_COGNITO_ISSUER: "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example",
  AWS_COGNITO_APP_CLIENT_ID: "client-123",
  AUTOMATION_TENANT_ID: "tenant-production",
};

function trustedRequestContext(method: string = "GET") {
  return {
    http: { method },
    authorizer: {
      jwt: {
        claims: {
          iss: env.AWS_COGNITO_ISSUER,
          client_id: env.AWS_COGNITO_APP_CLIENT_ID,
          token_use: "access",
          sub: "user-42",
        },
      },
    },
  };
}

function event(overrides: Partial<ApiGatewayHttpApiV2Event> = {}): ApiGatewayHttpApiV2Event {
  return {
    version: "2.0",
    rawPath: "/v1/automations",
    requestContext: trustedRequestContext(),
    ...overrides,
  };
}

function configured(handler: ControlPlaneHttpHandlerLike) {
  const result = createAwsControlPlaneLambdaHandler(env, handler);
  if (result.kind !== "CONFIGURED") throw new Error("expected configured Lambda handler");
  return result.handler;
}

describe("AWS control-plane Lambda adapter", () => {
  it("fails closed when Cognito deployment configuration is missing", () => {
    const result = createAwsControlPlaneLambdaHandler(
      { AWS_COGNITO_ISSUER: env.AWS_COGNITO_ISSUER },
      { handle: vi.fn() },
    );
    expect(result).toEqual({
      kind: "NOT_CONFIGURED",
      missing: ["AWS_COGNITO_APP_CLIENT_ID", "AUTOMATION_TENANT_ID"],
    });
  });

  it("maps verified API Gateway claims and payload-format 2.0 requests into the core handler", async () => {
    const handle = vi.fn(
      async (
        request: ControlPlaneHttpRequest,
        context: AuthenticatedControlPlaneContext,
      ): Promise<ControlPlaneHttpResponse> => ({
        status: 201,
        body: { request, scope: context.scope },
      }),
    );
    const lambda = configured({ handle });

    const response = await lambda(
      event({
        rawPath: "/v1/automations/automation-1/compile",
        body: JSON.stringify({ traceId: "trace-1", workflowId: "workflow-1" }),
        requestContext: {
          http: { method: "POST" },
          authorizer: {
            jwt: {
              claims: {
                iss: env.AWS_COGNITO_ISSUER,
                client_id: env.AWS_COGNITO_APP_CLIENT_ID,
                token_use: "access",
                sub: "user-42",
                tenantId: "attacker-tenant",
                userId: "attacker-user",
              },
            },
          },
        },
      }),
    );

    expect(handle).toHaveBeenCalledWith(
      {
        method: "POST",
        path: "/v1/automations/automation-1/compile",
        body: { traceId: "trace-1", workflowId: "workflow-1" },
      },
      { scope: { tenantId: "tenant-production", userId: "user-42" } },
    );
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("accepts base64-encoded JSON without exposing transport details to core", async () => {
    const handle = vi.fn(async (): Promise<ControlPlaneHttpResponse> => ({ status: 200, body: { ok: true } }));
    const lambda = configured({ handle });
    const json = JSON.stringify({ runId: "run-1" });
    const base64 = globalThis.btoa(String.fromCharCode(...new TextEncoder().encode(json)));

    const response = await lambda(
      event({
        body: base64,
        isBase64Encoded: true,
        requestContext: trustedRequestContext("POST"),
      }),
    );

    expect(handle.mock.calls[0]?.[0]).toEqual({
      method: "POST",
      path: "/v1/automations",
      body: { runId: "run-1" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("rejects invalid identity before the core handler is invoked", async () => {
    const handle = vi.fn(async (): Promise<ControlPlaneHttpResponse> => ({ status: 200, body: {} }));
    const lambda = configured({ handle });

    const response = await lambda(
      event({
        requestContext: {
          http: { method: "GET" },
          authorizer: {
            jwt: {
              claims: {
                iss: env.AWS_COGNITO_ISSUER,
                client_id: env.AWS_COGNITO_APP_CLIENT_ID,
                token_use: "id",
                sub: "user-42",
              },
            },
          },
        },
      }),
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "UNAUTHENTICATED", message: "authenticated Cognito identity is invalid" },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", event({ body: "{" }), 400, "BAD_REQUEST"],
    ["unsupported method", event({ requestContext: trustedRequestContext("DELETE") }), 400, "BAD_REQUEST"],
    ["invalid path", event({ rawPath: "v1/automations" }), 400, "BAD_REQUEST"],
    ["unsupported payload version", event({ version: "1.0" }), 400, "BAD_REQUEST"],
  ] as const)("rejects %s before dispatch", async (_name, input, expectedStatus, expectedCode) => {
    const handle = vi.fn(async (): Promise<ControlPlaneHttpResponse> => ({ status: 200, body: {} }));
    const response = await configured({ handle })(input);
    expect(response.statusCode).toBe(expectedStatus);
    expect((JSON.parse(response.body) as { error: { code: string } }).error.code).toBe(expectedCode);
    expect(handle).not.toHaveBeenCalled();
  });

  it("bounds request body size before JSON parsing or dispatch", async () => {
    const handle = vi.fn(async (): Promise<ControlPlaneHttpResponse> => ({ status: 200, body: {} }));
    const response = await configured({ handle })(
      event({ body: JSON.stringify({ value: "x".repeat(1_048_576) }) }),
    );
    expect(response.statusCode).toBe(413);
    expect((JSON.parse(response.body) as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(handle).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected handler failures", async () => {
    const lambda = configured({
      handle: async () => {
        throw new Error("secret provider response with token abc123");
      },
    });
    const response = await lambda(event());
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(
      JSON.stringify({ error: { code: "INTERNAL", message: "control-plane request failed" } }),
    );
    expect(response.body).not.toContain("abc123");
  });
});
