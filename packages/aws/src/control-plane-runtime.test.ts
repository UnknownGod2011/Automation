import { describe, expect, it } from "vitest";
import {
  createAwsControlPlaneRuntimeEntrypoint,
  type AwsControlPlaneRuntimeBootstrapFactory,
} from "./control-plane-runtime.js";
import type { ApiGatewayHttpApiV2Event } from "./control-plane-lambda.js";

const event: ApiGatewayHttpApiV2Event = {
  version: "2.0",
  rawPath: "/automations",
  requestContext: {
    http: { method: "GET" },
    authorizer: {
      jwt: {
        claims: {
          iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
          client_id: "client-id",
          token_use: "access",
          sub: "user-1",
        },
      },
    },
  },
};

describe("createAwsControlPlaneRuntimeEntrypoint", () => {
  it("memoizes configured bootstrap and forwards requests", async () => {
    let bootstrapCalls = 0;
    let handlerCalls = 0;
    const bootstrap: AwsControlPlaneRuntimeBootstrapFactory = () => {
      bootstrapCalls += 1;
      return {
        kind: "CONFIGURED",
        lambda: {
          async handler(received) {
            handlerCalls += 1;
            expect(received).toBe(event);
            return { statusCode: 204, body: "" };
          },
        },
      };
    };
    const runtime = createAwsControlPlaneRuntimeEntrypoint({}, bootstrap);

    expect((await runtime.handler(event)).statusCode).toBe(204);
    expect((await runtime.handler(event)).statusCode).toBe(204);
    expect(bootstrapCalls).toBe(1);
    expect(handlerCalls).toBe(2);
  });

  it("returns a fixed sanitized NOT_CONFIGURED response without repeating bootstrap", async () => {
    let bootstrapCalls = 0;
    const runtime = createAwsControlPlaneRuntimeEntrypoint(
      { AWS_SECRET_ACCESS_KEY: "must-not-leak" },
      () => {
        bootstrapCalls += 1;
        return { kind: "NOT_CONFIGURED" };
      },
    );

    const first = await runtime.handler(event);
    const second = await runtime.handler(event);
    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(503);
    expect(first.body).toContain("NOT_CONFIGURED");
    expect(first.body).not.toContain("must-not-leak");
    expect(first.headers?.["Cache-Control"]).toBe("no-store");
    expect(bootstrapCalls).toBe(1);
  });

  it("memoizes bootstrap rejection and never reflects underlying errors", async () => {
    let bootstrapCalls = 0;
    const runtime = createAwsControlPlaneRuntimeEntrypoint({}, () => {
      bootstrapCalls += 1;
      throw new Error("provider secret should never escape");
    });

    const first = await runtime.handler(event);
    const second = await runtime.handler(event);
    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(500);
    expect(first.body).toContain("INTERNAL_ERROR");
    expect(first.body).not.toContain("provider secret");
    expect(bootstrapCalls).toBe(1);
  });
});
