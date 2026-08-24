import type { AutomationRepository, OwnershipScope } from "./index.js";
import type {
  CaptureSessionStore,
  CaptureCompletionService,
  CompleteCaptureResult,
} from "./capture-completion.js";
import type {
  CaptureCollectionControl,
  CaptureCollectionService,
} from "./capture-collector.js";

export interface CaptureCollectionWorkerRequest {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
}

export interface CaptureCollectionWorkerDependencies {
  automations: Pick<AutomationRepository, "get">;
  sessions: CaptureSessionStore;
  controls: CaptureCollectionControl;
  collector: Pick<CaptureCollectionService, "collect">;
  completion: Pick<CaptureCompletionService, "complete">;
}

/**
 * Provider-neutral execution-plane worker for one durable capture session.
 * Browser observation is delegated to the collector; durable acceptance is
 * delegated to CaptureCompletionService so profile-save-before-trace ordering
 * remains the single completion authority.
 */
export class CaptureCollectionWorker {
  constructor(private readonly dependencies: CaptureCollectionWorkerDependencies) {}

  async execute(request: CaptureCollectionWorkerRequest): Promise<CompleteCaptureResult> {
    const automation = await this.dependencies.automations.get(
      request.scope,
      request.automationId,
    );
    if (!automation) throw new Error("capture automation not found");
    if (
      automation.tenantId !== request.scope.tenantId ||
      automation.userId !== request.scope.userId ||
      automation.automationId !== request.automationId
    ) {
      throw new Error("capture automation ownership mismatch");
    }

    const session = await this.dependencies.sessions.get(
      request.scope,
      request.captureSessionId,
    );
    if (!session) throw new Error("capture session not found");
    if (
      session.tenantId !== request.scope.tenantId ||
      session.userId !== request.scope.userId ||
      session.automationId !== request.automationId
    ) {
      throw new Error("capture session identity mismatch");
    }

    if (session.status === "COMPLETED") {
      if (!session.traceId) throw new Error("completed capture session has no trace identity");
      return {
        traceId: session.traceId,
        replayed: true,
        cleanupPending: false,
      };
    }

    const trace = await this.dependencies.collector.collect({
      scope: request.scope,
      automation,
      session,
      control: this.dependencies.controls,
    });

    return this.dependencies.completion.complete({
      scope: request.scope,
      automationId: request.automationId,
      captureSessionId: request.captureSessionId,
      trace,
    });
  }
}
