import type {
  ApiGatewayHttpApiV2Event,
  ApiGatewayHttpApiV2Response,
} from "./control-plane-lambda.js";
import {
  createAwsCaptureCompletionLambdaHandler,
  type TrustedCaptureCompletionHandlerLike,
} from "./capture-completion-lambda.js";
import { createAwsControlPlaneBootstrap } from "./control-plane-bootstrap.js";

export type AwsCaptureCompletionRuntimeBootstrapResult =
  | { kind: "NOT_CONFIGURED" }
  | { kind: "CONFIGURED"; captureCompletion: TrustedCaptureCompletionHandlerLike };

export type AwsCaptureCompletionRuntimeBootstrapFactory = (
  env: Readonly<Record<string, string | undefined>>,
) => AwsCaptureCompletionRuntimeBootstrapResult;

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

function fixedFailure(
  statusCode: 500 | 503,
  code: "INTERNAL_ERROR" | "NOT_CONFIGURED",
  message: string,
): ApiGatewayHttpApiV2Response {
  return {
    statusCode,
    headers: responseHeaders,
    body: JSON.stringify({ error: { code, message } }),
    isBase64Encoded: false,
  };
}

/**
 * Lazy process-scoped runtime for the privileged capture-completion Lambda.
 * The default bootstrap reuses the production control-plane dependency graph but
 * exposes only its separated trusted completion handler. The dedicated Lambda IAM
 * role grants only the subset of data/browser permissions needed by that path.
 */
export function createAwsCaptureCompletionRuntimeEntrypoint(
  env: Readonly<Record<string, string | undefined>>,
  bootstrapFactory: AwsCaptureCompletionRuntimeBootstrapFactory = (runtimeEnv) => {
    const bootstrap = createAwsControlPlaneBootstrap({ env: runtimeEnv });
    return bootstrap.kind === "CONFIGURED"
      ? { kind: "CONFIGURED", captureCompletion: bootstrap.captureCompletion }
      : { kind: "NOT_CONFIGURED" };
  },
): {
  handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response>;
} {
  let bootstrap: Promise<AwsCaptureCompletionRuntimeBootstrapResult> | undefined;

  const load = (): Promise<AwsCaptureCompletionRuntimeBootstrapResult> => {
    bootstrap ??= Promise.resolve().then(() => bootstrapFactory(env));
    return bootstrap;
  };

  return {
    async handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response> {
      try {
        const result = await load();
        if (result.kind === "NOT_CONFIGURED") {
          return fixedFailure(
            503,
            "NOT_CONFIGURED",
            "Capture completion is not configured for this deployment",
          );
        }
        const lambda = createAwsCaptureCompletionLambdaHandler(env, result.captureCompletion);
        if (lambda.kind === "NOT_CONFIGURED") {
          return fixedFailure(
            503,
            "NOT_CONFIGURED",
            "Capture completion is not configured for this deployment",
          );
        }
        return await lambda.handler(event);
      } catch {
        return fixedFailure(500, "INTERNAL_ERROR", "Capture completion request failed");
      }
    },
  };
}
