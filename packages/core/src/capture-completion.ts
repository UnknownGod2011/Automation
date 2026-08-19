import type { CaptureTrace } from "@automation/contracts";
import type { OwnershipScope } from "./index.js";

export type CaptureSessionStatus = "STARTED" | "COMPLETED";

export interface CaptureSessionRecord {
  tenantId: string;
  userId: string;
  automationId: string;
  captureSessionId: string;
  browserSessionId: string;
  browserProfileRef: string;
  startedAt: string;
  expiresAt: string;
  status: CaptureSessionStatus;
  traceId?: string;
  completedAt?: string;
}

export interface CaptureSessionStore {
  putStarted(record: CaptureSessionRecord): Promise<void>;
  get(scope: OwnershipScope, captureSessionId: string): Promise<CaptureSessionRecord | null>;
  complete(
    scope: OwnershipScope,
    captureSessionId: string,
    traceId: string,
    completedAt: string,
  ): Promise<"COMPLETED" | "REPLAY">;
  latestCompletedForAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<CaptureSessionRecord | null>;
}

export interface CaptureSessionFinalizer {
  saveProfile(scope: OwnershipScope, record: CaptureSessionRecord): Promise<void>;
  stop(scope: OwnershipScope, record: CaptureSessionRecord): Promise<void>;
}

export interface CaptureTracePersister {
  persistCapture(request: { scope: OwnershipScope; trace: CaptureTrace }): Promise<CaptureTrace>;
}

export interface CompleteCaptureRequest {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
  trace: CaptureTrace;
}

export interface CompleteCaptureResult {
  traceId: string;
  replayed: boolean;
  cleanupPending: boolean;
}

function assertOwned(scope: OwnershipScope, record: CaptureSessionRecord): void {
  if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
    throw new Error("capture session ownership does not match scope");
  }
}

function assertTraceMatches(
  request: CompleteCaptureRequest,
  record: CaptureSessionRecord,
): void {
  const { trace } = request;
  if (
    trace.tenantId !== request.scope.tenantId ||
    trace.userId !== request.scope.userId ||
    trace.automationId !== request.automationId ||
    trace.browserProfileRef !== record.browserProfileRef
  ) {
    throw new Error("capture trace identity does not match the durable capture session");
  }
}

export class CaptureCompletionService {
  constructor(
    private readonly sessions: CaptureSessionStore,
    private readonly finalizer: CaptureSessionFinalizer,
    private readonly traces: CaptureTracePersister,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async complete(request: CompleteCaptureRequest): Promise<CompleteCaptureResult> {
    const record = await this.sessions.get(request.scope, request.captureSessionId);
    if (!record) throw new Error("capture session not found");
    assertOwned(request.scope, record);
    if (record.automationId !== request.automationId) {
      throw new Error("capture session belongs to another automation");
    }
    assertTraceMatches(request, record);

    if (record.status === "COMPLETED") {
      if (record.traceId !== request.trace.traceId) {
        throw new Error("capture session is already completed with another trace");
      }
      return { traceId: record.traceId, replayed: true, cleanupPending: false };
    }

    const now = this.now();
    if (new Date(record.expiresAt).getTime() <= now.getTime()) {
      throw new Error("capture session expired before completion");
    }

    // Profile persistence is intentionally before trace acceptance: the compiler must never
    // accept a demonstration whose authenticated browser state was not durably saved.
    await this.finalizer.saveProfile(request.scope, record);
    await this.traces.persistCapture({ scope: request.scope, trace: request.trace });
    const outcome = await this.sessions.complete(
      request.scope,
      record.captureSessionId,
      request.trace.traceId,
      now.toISOString(),
    );

    let cleanupPending = false;
    try {
      await this.finalizer.stop(request.scope, record);
    } catch {
      cleanupPending = true;
    }

    return {
      traceId: request.trace.traceId,
      replayed: outcome === "REPLAY",
      cleanupPending,
    };
  }
}

const key = (scope: OwnershipScope, captureSessionId: string): string =>
  `${scope.tenantId}:${scope.userId}:${captureSessionId}`;

export class InMemoryCaptureSessionStore implements CaptureSessionStore {
  private readonly records = new Map<string, CaptureSessionRecord>();

  async putStarted(record: CaptureSessionRecord): Promise<void> {
    if (record.status !== "STARTED" || record.traceId || record.completedAt) {
      throw new Error("new capture session must be STARTED without completion metadata");
    }
    const scope = { tenantId: record.tenantId, userId: record.userId };
    const recordKey = key(scope, record.captureSessionId);
    if (this.records.has(recordKey)) throw new Error("capture session already exists");
    this.records.set(recordKey, structuredClone(record));
  }

  async get(scope: OwnershipScope, captureSessionId: string): Promise<CaptureSessionRecord | null> {
    const record = this.records.get(key(scope, captureSessionId));
    return record ? structuredClone(record) : null;
  }

  async complete(
    scope: OwnershipScope,
    captureSessionId: string,
    traceId: string,
    completedAt: string,
  ): Promise<"COMPLETED" | "REPLAY"> {
    const recordKey = key(scope, captureSessionId);
    const record = this.records.get(recordKey);
    if (!record) throw new Error("capture session not found");
    assertOwned(scope, record);
    if (record.status === "COMPLETED") {
      if (record.traceId !== traceId) throw new Error("capture session completion conflict");
      return "REPLAY";
    }
    this.records.set(recordKey, {
      ...record,
      status: "COMPLETED",
      traceId,
      completedAt,
    });
    return "COMPLETED";
  }

  async latestCompletedForAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<CaptureSessionRecord | null> {
    const records = [...this.records.values()]
      .filter(
        (record) =>
          record.tenantId === scope.tenantId &&
          record.userId === scope.userId &&
          record.automationId === automationId &&
          record.status === "COMPLETED",
      )
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return records[0] ? structuredClone(records[0]) : null;
  }
}
