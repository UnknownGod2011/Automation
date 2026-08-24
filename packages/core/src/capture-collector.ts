import { assertCaptureTrace, type AutomationRecord, type CaptureEvent, type CaptureTrace } from "@automation/contracts";
import type { CaptureSessionRecord } from "./capture-completion.js";
import type { OwnershipScope } from "./index.js";

export type CaptureCollectionPhase = "AUTH_SETUP" | "WORKFLOW";

export interface CaptureCollectionControlState {
  phase: CaptureCollectionPhase;
  finishRequested: boolean;
}

export interface CaptureCollectionControl {
  getState(scope: OwnershipScope, captureSessionId: string): Promise<CaptureCollectionControlState>;
}

export interface CaptureCollectionSourceRequest {
  scope: OwnershipScope;
  automation: AutomationRecord;
  session: CaptureSessionRecord;
  control: CaptureCollectionControl;
}

export interface CaptureCollectionEventSource {
  collect(request: CaptureCollectionSourceRequest): Promise<readonly CaptureEvent[]>;
}

export interface CollectCaptureRequest {
  scope: OwnershipScope;
  automation: AutomationRecord;
  session: CaptureSessionRecord;
  control: CaptureCollectionControl;
}

export interface CaptureTraceIdFactory {
  create(scope: OwnershipScope, automationId: string, captureSessionId: string): string;
}

function defaultTraceIdFactory(): CaptureTraceIdFactory {
  return {
    create: (_scope, _automationId, captureSessionId) => `trace-${captureSessionId}`,
  };
}

function assertOwned(scope: OwnershipScope, automation: AutomationRecord, session: CaptureSessionRecord): void {
  if (automation.tenantId !== scope.tenantId || automation.userId !== scope.userId) {
    throw new Error("automation ownership does not match capture scope");
  }
  if (session.tenantId !== scope.tenantId || session.userId !== scope.userId) {
    throw new Error("capture session ownership does not match capture scope");
  }
  if (session.automationId !== automation.automationId) {
    throw new Error("capture session belongs to another automation");
  }
  if (!automation.browserProfileRef || automation.browserProfileRef !== session.browserProfileRef) {
    throw new Error("capture browser profile does not match automation");
  }
  if (session.status !== "STARTED") {
    throw new Error("capture collection requires a STARTED session");
  }
}

export class CaptureCollectionService {
  private readonly traceIds: CaptureTraceIdFactory;
  private readonly now: () => Date;

  constructor(
    private readonly source: CaptureCollectionEventSource,
    options: { traceIds?: CaptureTraceIdFactory; now?: () => Date } = {},
  ) {
    this.traceIds = options.traceIds ?? defaultTraceIdFactory();
    this.now = options.now ?? (() => new Date());
  }

  async collect(request: CollectCaptureRequest): Promise<CaptureTrace> {
    assertOwned(request.scope, request.automation, request.session);
    const startedAt = new Date(request.session.startedAt).getTime();
    const expiresAt = new Date(request.session.expiresAt).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || expiresAt <= startedAt) {
      throw new Error("capture session timestamps are invalid");
    }

    const events = await this.source.collect({
      scope: request.scope,
      automation: request.automation,
      session: request.session,
      control: request.control,
    });
    const finishedAt = this.now();
    if (finishedAt.getTime() >= expiresAt) {
      throw new Error("capture session expired before collection completed");
    }

    const trace: CaptureTrace = {
      schemaVersion: 1,
      traceId: this.traceIds.create(
        request.scope,
        request.automation.automationId,
        request.session.captureSessionId,
      ),
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      automationId: request.automation.automationId,
      websiteUrl: request.automation.websiteUrl,
      objective: request.automation.prompt,
      browserProfileRef: request.session.browserProfileRef,
      startedAt: request.session.startedAt,
      finishedAt: finishedAt.toISOString(),
      events: events.map((event) => structuredClone(event)),
    };
    assertCaptureTrace(trace);
    return trace;
  }
}
