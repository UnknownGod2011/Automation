import type { CaptureTrace } from "@automation/contracts";
import type {
  TrustedCaptureCompletionContext,
  TrustedCaptureCompletionRequest,
  TrustedCaptureCompletionResponse,
} from "@automation/core";
import type {
  ApiGatewayHttpApiV2Event,
  ApiGatewayHttpApiV2Response,
} from "./control-plane-lambda.js";

const MAX_CAPTURE_COMPLETION_BODY_BYTES = 1_048_576;
const CAPTURE_COMPLETION_PATH = "/capture/complete";

export interface TrustedCaptureCompletionHandlerLike {
  handle(
    request: TrustedCaptureCompletionRequest,
    context: TrustedCaptureCompletionContext,
  ): Promise<TrustedCaptureCompletionResponse>;
}

export type AwsCaptureCompletionLambdaResult =
  | { kind: "NOT_CONFIGURED"; missing: readonly string[] }
  | {
      kind: "CONFIGURED";
      handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response>;
    };

class CaptureCompletionRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 413,
    readonly code: "BAD_REQUEST" | "FORBIDDEN" | "PAYLOAD_TOO_LARGE",
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

function decodeBase64Utf8(value: string): string {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "request body encoding is invalid");
  }
}

function parseBody(event: ApiGatewayHttpApiV2Event): unknown {
  if (event.body === undefined || event.body === null || event.body === "") {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "request body is required");
  }
  const decoded = event.isBase64Encoded ? decodeBase64Utf8(event.body) : event.body;
  if (new TextEncoder().encode(decoded).byteLength > MAX_CAPTURE_COMPLETION_BODY_BYTES) {
    throw new CaptureCompletionRequestError(413, "PAYLOAD_TOO_LARGE", "request body is too large");
  }
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "request body must contain valid JSON");
  }
}

function requiredString(value: unknown, name: string, maxLength = 512): string {
  if (typeof value !== "string") {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", `${name} is required`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", `${name} is invalid`);
  }
  return normalized;
}

function parseRequest(body: unknown): TrustedCaptureCompletionRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "request body must be an object");
  }
  const candidate = body as Readonly<Record<string, unknown>>;
  if (typeof candidate.trace !== "object" || candidate.trace === null || Array.isArray(candidate.trace)) {
    throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "capture trace is required");
  }
  return {
    automationId: requiredString(candidate.automationId, "automationId"),
    captureSessionId: requiredString(candidate.captureSessionId, "captureSessionId", 160),
    trace: candidate.trace as CaptureTrace,
  };
}

function requestFailure(error: CaptureCompletionRequestError): ApiGatewayHttpApiV2Response {
  return jsonResponse(error.statusCode, {
    error: { code: error.code, message: error.message },
  });
}

function internalFailure(): ApiGatewayHttpApiV2Response {
  return jsonResponse(500, {
    error: { code: "INTERNAL", message: "capture completion request failed" },
  });
}

/**
 * Transport for the dedicated IAM-authorized capture-completion API.
 *
 * Authentication is deliberately not inferred from request JSON. The production
 * route uses API Gateway `AWS_IAM`, so API Gateway verifies SigV4 and
 * `execute-api:Invoke` before Lambda invocation. The Lambda resource policy in
 * IaC permits only that API route. This adapter then derives user scope from the
 * signed worker's trace and independently pins tenant scope to deployment config.
 */
export function createAwsCaptureCompletionLambdaHandler(
  env: Readonly<Record<string, string | undefined>>,
  completion: TrustedCaptureCompletionHandlerLike,
): AwsCaptureCompletionLambdaResult {
  const tenantId = env.AUTOMATION_TENANT_ID?.trim();
  if (!tenantId) return { kind: "NOT_CONFIGURED", missing: ["AUTOMATION_TENANT_ID"] };

  return {
    kind: "CONFIGURED",
    handler: async (event) => {
      try {
        if (event.version !== undefined && event.version !== "2.0") {
          throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "unsupported API Gateway payload version");
        }
        if (event.requestContext?.http?.method !== "POST" || event.rawPath !== CAPTURE_COMPLETION_PATH) {
          throw new CaptureCompletionRequestError(400, "BAD_REQUEST", "capture completion route is invalid");
        }

        const request = parseRequest(parseBody(event));
        const trace = request.trace;
        const traceTenantId = requiredString(trace.tenantId, "trace.tenantId");
        const traceUserId = requiredString(trace.userId, "trace.userId");
        if (traceTenantId !== tenantId) {
          throw new CaptureCompletionRequestError(403, "FORBIDDEN", "capture tenant does not match deployment scope");
        }

        const response = await completion.handle(request, {
          scope: { tenantId, userId: traceUserId },
          trustedCaptureWorker: true,
        });
        return jsonResponse(response.status, response.body);
      } catch (error) {
        if (error instanceof CaptureCompletionRequestError) return requestFailure(error);
        return internalFailure();
      }
    },
  };
}
