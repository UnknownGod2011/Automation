import { describe, expect, it } from "vitest";
import {
  AwsCognitoAuthError,
  createAwsCognitoControlPlaneContextResolver,
  loadAwsCognitoControlPlaneAuthConfig,
  resolveCognitoControlPlaneContext,
} from "./cognito-auth.js";

const config = {
  issuer: "https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_example",
  audience: "client-123",
  tenantId: "tenant-production",
};

function context(claims: Readonly<Record<string, unknown>>) {
  return { authorizer: { jwt: { claims } } };
}

describe("Cognito control-plane authentication", () => {
  it("fails closed when deployment configuration is incomplete", () => {
    expect(loadAwsCognitoControlPlaneAuthConfig({ AWS_COGNITO_ISSUER: config.issuer })).toEqual({
      configured: false,
      missing: ["AWS_COGNITO_APP_CLIENT_ID", "AUTOMATION_TENANT_ID"],
      message:
        "Cognito control-plane authentication is not configured: missing AWS_COGNITO_APP_CLIENT_ID, AUTOMATION_TENANT_ID",
    });
  });

  it("derives ownership from trusted deployment tenant plus access-token sub", () => {
    const resolved = resolveCognitoControlPlaneContext(
      context({
        iss: config.issuer,
        client_id: config.audience,
        sub: "cognito-user-42",
        token_use: "access",
        tenantId: "attacker-tenant",
        userId: "attacker-user",
      }),
      config,
    );

    expect(resolved).toEqual({
      scope: { tenantId: "tenant-production", userId: "cognito-user-42" },
    });
  });

  it.each([
    ["missing claims", {}, "authenticated JWT claims are missing"],
    [
      "wrong issuer",
      context({ iss: "https://evil.example", client_id: config.audience, sub: "user", token_use: "access" }),
      "authenticated Cognito identity is invalid",
    ],
    [
      "wrong client",
      context({ iss: config.issuer, client_id: "other-client", sub: "user", token_use: "access" }),
      "authenticated Cognito identity is invalid",
    ],
    [
      "id token",
      context({ iss: config.issuer, aud: config.audience, sub: "user", token_use: "id" }),
      "authenticated Cognito identity is invalid",
    ],
    [
      "missing subject",
      context({ iss: config.issuer, client_id: config.audience, token_use: "access" }),
      "authenticated Cognito identity is invalid",
    ],
  ])("rejects %s", (_name, requestContext, message) => {
    expect(() => resolveCognitoControlPlaneContext(requestContext, config)).toThrowError(
      new AwsCognitoAuthError("UNAUTHENTICATED", message),
    );
  });

  it("creates an explicit NOT_CONFIGURED-style resolver result without cloud credentials", () => {
    const missing = createAwsCognitoControlPlaneContextResolver({});
    expect(missing.configured).toBe(false);

    const configured = createAwsCognitoControlPlaneContextResolver({
      AWS_COGNITO_ISSUER: config.issuer,
      AWS_COGNITO_APP_CLIENT_ID: config.audience,
      AUTOMATION_TENANT_ID: config.tenantId,
    });
    expect(configured.configured).toBe(true);
    if (!configured.configured) throw new Error("expected configured resolver");
    expect(
      configured.resolve(
        context({ iss: config.issuer, client_id: config.audience, sub: "user-1", token_use: "access" }),
      ),
    ).toEqual({ scope: { tenantId: config.tenantId, userId: "user-1" } });
  });
});
