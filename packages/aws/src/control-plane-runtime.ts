import type {
  ApiGatewayHttpApiV2Event,
  ApiGatewayHttpApiV2Response,
} from "./control-plane-lambda.js";
import { createAwsControlPlaneBootstrap } from "./control-plane-bootstrap.js";

export type AwsControlPlaneRuntimeBootstrapResult =
  | { kind: "NOT_CONFIGURED" }
  | {
      kind: "CONFIGURED";
      lambda: {
        handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response>;
      };
    };

export type AwsControlPlaneRuntimeBootstrapFactory = (
  env: Readonly<Record<string, string | undefined>>,
) => AwsControlPlaneRuntimeBootstrapResult;

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
 * Process-scoped Lambda entrypoint composition. Bootstrap is lazy so imports and
 * cold starts never make AWS network calls. A rejected bootstrap is memoized:
 * configuration/provider failures do not trigger repeated initialization work
 * on every request in the same Lambda environment.
 */
export function createAwsControlPlaneRuntimeEntrypoint(
  env: Readonly<Record<string, string | undefined>>,
  bootstrapFactory: AwsControlPlaneRuntimeBootstrapFactory = (runtimeEnv) =>
    createAwsControlPlaneBootstrap({ env: runtimeEnv }),
): {
  handler(event: ApiGatewayHttpApiV2Event): Promise<ApiGatewayHttpApiV2Response>;
} {
  let bootstrap: Promise<AwsControlPlaneRuntimeBootstrapResult> | undefined;

  const load = (): Promise<AwsControlPlaneRuntimeBootstrapResult> => {
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
            "Control plane is not configured for this deployment",
          );
        }
        return await result.lambda.handler(event);
      } catch {
        return fixedFailure(500, "INTERNAL_ERROR", "Control plane request failed");
      }
    },
  };
}
