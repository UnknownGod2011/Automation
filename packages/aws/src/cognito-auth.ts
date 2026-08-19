import type { AuthenticatedControlPlaneContext } from "@automation/core";

export interface AwsCognitoControlPlaneAuthConfig {
  issuer: string;
  audience: string;
  tenantId: string;
}

export type AwsCognitoControlPlaneAuthConfigResult =
  | { configured: true; config: AwsCognitoControlPlaneAuthConfig }
  | { configured: false; missing: readonly string[]; message: string };

export interface ApiGatewayJwtAuthorizerContext {
  authorizer?: {
    jwt?: {
      claims?: Readonly<Record<string, unknown>> | undefined;
    } | undefined;
  } | undefined;
}

export class AwsCognitoAuthError extends Error {
  readonly code: "UNAUTHENTICATED" | "MISCONFIGURED";

  constructor(code: "UNAUTHENTICATED" | "MISCONFIGURED", message: string) {
    super(message);
    this.name = "AwsCognitoAuthError";
    this.code = code;
  }
}

function nonEmptyEnv(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function claimString(claims: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = claims[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function audienceMatches(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") && value.includes(expected);
}

export function loadAwsCognitoControlPlaneAuthConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsCognitoControlPlaneAuthConfigResult {
  const issuer = nonEmptyEnv(env, "AWS_COGNITO_ISSUER");
  const audience = nonEmptyEnv(env, "AWS_COGNITO_APP_CLIENT_ID");
  const tenantId = nonEmptyEnv(env, "AUTOMATION_TENANT_ID");
  const missing: string[] = [];
  if (!issuer) missing.push("AWS_COGNITO_ISSUER");
  if (!audience) missing.push("AWS_COGNITO_APP_CLIENT_ID");
  if (!tenantId) missing.push("AUTOMATION_TENANT_ID");
  if (!issuer || !audience || !tenantId) {
    return {
      configured: false,
      missing,
      message: `Cognito control-plane authentication is not configured: missing ${missing.join(", ")}`,
    };
  }
  return { configured: true, config: { issuer, audience, tenantId } };
}

/**
 * Converts claims already verified by an API Gateway JWT authorizer into the
 * provider-neutral control-plane identity. This function does not accept a raw
 * bearer token and is not a JWT verifier; API Gateway remains the signature,
 * expiry, issuer and audience verification boundary.
 */
export function resolveCognitoControlPlaneContext(
  requestContext: ApiGatewayJwtAuthorizerContext,
  config: AwsCognitoControlPlaneAuthConfig,
): AuthenticatedControlPlaneContext {
  const claims = requestContext.authorizer?.jwt?.claims;
  if (!claims) throw new AwsCognitoAuthError("UNAUTHENTICATED", "authenticated JWT claims are missing");

  const issuer = claimString(claims, "iss");
  const subject = claimString(claims, "sub");
  const tokenUse = claimString(claims, "token_use");
  if (issuer !== config.issuer || !audienceMatches(claims.aud, config.audience) || tokenUse !== "id" || !subject) {
    throw new AwsCognitoAuthError("UNAUTHENTICATED", "authenticated Cognito identity is invalid");
  }

  return {
    scope: {
      tenantId: config.tenantId,
      userId: subject,
    },
  };
}

export function createAwsCognitoControlPlaneContextResolver(
  env: Readonly<Record<string, string | undefined>>,
):
  | { configured: false; missing: readonly string[]; message: string }
  | {
      configured: true;
      resolve(requestContext: ApiGatewayJwtAuthorizerContext): AuthenticatedControlPlaneContext;
    } {
  const loaded = loadAwsCognitoControlPlaneAuthConfig(env);
  if (!loaded.configured) return loaded;
  return {
    configured: true,
    resolve: (requestContext) => resolveCognitoControlPlaneContext(requestContext, loaded.config),
  };
}
