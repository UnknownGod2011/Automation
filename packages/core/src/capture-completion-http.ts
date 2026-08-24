import type { CaptureTrace } from "@automation/contracts";
import type { OwnershipScope } from "./index.js";
import type { CaptureCompletionService } from "./capture-completion.js";

export interface TrustedCaptureCompletionContext {
  scope: OwnershipScope;
  /** Set only by deployment authentication that verifies the capture worker/callback identity. */
  trustedCaptureWorker: boolean;
}

export interface TrustedCaptureCompletionRequest {
  automationId: string;
  captureSessionId: string;
  trace: CaptureTrace;
}

export interface TrustedCaptureCompletionResponse {
  status: number;
  body: unknown;
}

export class TrustedCaptureCompletionHandler {
  constructor(private readonly service: CaptureCompletionService) {}

  async handle(
    request: TrustedCaptureCompletionRequest,
    context: TrustedCaptureCompletionContext,
  ): Promise<TrustedCaptureCompletionResponse> {
    if (!context.trustedCaptureWorker) {
      return { status: 403, body: { error: { code: "FORBIDDEN", message: "trusted capture worker required" } } };
    }
    try {
      const result = await this.service.complete({
        scope: context.scope,
        automationId: request.automationId,
        captureSessionId: request.captureSessionId,
        trace: request.trace,
      });
      return { status: result.replayed ? 200 : 202, body: result };
    } catch {
      return {
        status: 409,
        body: { error: { code: "CAPTURE_COMPLETION_REJECTED", message: "capture completion could not be accepted" } },
      };
    }
  }
}
