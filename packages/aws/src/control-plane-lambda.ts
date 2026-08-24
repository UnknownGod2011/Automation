import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "@automation/core";
import {
  AwsCognitoAuthError,
  createAwsCognitoControlPlaneContextResolver,
  type ApiGatewayJwtAuthorizerContext,
} from "./cognito-auth.js";

const MAX_REQUEST_BODY_BYTES = 1_048_576;

export interface ControlPlaneHttpHandlerLike {
  handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse>;
}

export interface ApiGatewayHttpApiV2Event {
  version?: string;
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: ApiGatewayJwtAuthorizerContext & {
    http?: {
      method?: string;
    };
  };
}

export interface ApiGatewayHttpApiV2Response {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
  isBase64Encoded: false;
}

export type AwsControlPlaneLambdaResult =
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] }
  | {
      kind: "CONFIGURED";
      handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response>;
    };

class AwsControlPlaneRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 413,
    readonly code: "BAD_REQUEST" | "UNAUTHENTICATED" | "PAYLOAD_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}

function jsonResponse(statusCode: number, body: unknown): ApiGatewayHttpApiV2Response {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function requestFailure(error: AwsControlPlaneRequestError): ApiGatewayHttpApiV2Response {
  return jsonResponse(error.statusCode, {
    error: { code: error.code, message: error.message },
  });
}

function internalFailure(): ApiGatewayHttpApiV2Response {
  return jsonResponse(500, {
    error: { code: "INTERNAL", message: "control-plane request failed" },
  });
}

function parseMethod(event: ApiGatewayHttpApiV2Event): ControlPlaneHttpRequest["method"] {
  const method = event.requestContext?.http?.method;
  if (method === "GET" || method === "POST") return method;
  throw new AwsControlPlaneRequestError(400, "BAD_REQUEST", "unsupported HTTP method");
}

function parsePath(event: ApiGatewayHttpApiV2Event): string {
  const value = event.rawPath;
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2_048) {
    throw new AwsControlPlaneRequestError(400, "BAD_REQUEST", "request path is invalid");
  }
  return value;
}

function decodeBase64Utf8(value: string): string {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AwsControlPlaneRequestError(400, "BAD_REQUEST", "request body encoding is invalid");
  }
}

function decodeBody(event: ApiGatewayHttpApiV2Event): string | undefined {
  if (event.body === undefined || event.body === null || event.body === "") return undefined;
  const decoded = event.isBase64Encoded ? decodeBase64Utf8(event.body) : event.body;
  if (new TextEncoder().encode(decoded).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new AwsControlPlaneRequestError(413, "PAYLOAD_TOO_LARGE", "request body is too large");
  }
  return decoded;
}

function parseBody(event: ApiGatewayHttpApiV2Event): unknown {
  const decoded = decodeBody(event);
  if (decoded === undefined) return undefined;
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new AwsControlPlaneRequestError(400, "BAD_REQUEST", "request body must contain valid JSON");
  }
}

function toControlPlaneRequest(event: ApiGatewayHttpApiV2Event): ControlPlaneHttpRequest {
  const body = parseBody(event);
  return {
    method: parseMethod(event),
    path: parsePath(event),
    ...(body !== undefined ? { body } : {}),
  };
}

function toLambdaResponse(response: ControlPlaneHttpResponse): ApiGatewayHttpApiV2Response {
  return jsonResponse(response.status, response.body);
}

/**
 * Adapts API Gateway HTTP API payload-format 2.0 requests into the
 * provider-neutral control-plane HTTP contract. JWT signature, expiry and
 * OAuth-scope verification remain API Gateway responsibilities; this boundary
 * consumes only already-verified authorizer claims.
 */
export function createAwsControlPlaneLambdaHandler(
  env: Readonly<Record<string, string | undefined>>,
  controlPlane: ControlPlaneHttpHandlerLike,
): AwsControlPlaneLambdaResult {
  const auth = createAwsCognitoControlPlaneContextResolver(env);
  if (!auth.configured) return { kind: "NOT_CONFIGURED", missing: auth.missing };

  return {
    kind: "CONFIGURED",
    handler: async (event) => {
      try {
        if (event.version !== undefined && event.version !== "2.0") {
          throw new AwsControlPlaneRequestError(400, "BAD_REQUEST", "unsupported API Gateway payload version");
        }
        const context = auth.resolve(event.requestContext ?? {});
        const request = toControlPlaneRequest(event);
        return toLambdaResponse(await controlPlane.handle(request, context));
      } catch (error) {
        if (error instanceof AwsControlPlaneRequestError) return requestFailure(error);
        if (error instanceof AwsCognitoAuthError) {
          return requestFailure(
            new AwsControlPlaneRequestError(401, "UNAUTHENTICATED", "authenticated Cognito identity is invalid"),
          );
        }
        return internalFailure();
      }
    },
  };
}
