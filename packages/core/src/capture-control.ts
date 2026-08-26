import type { CaptureCollectionControl, CaptureCollectionControlState, CaptureCollectionPhase } from "./capture-collector.js";
import type { CaptureSessionStore } from "./capture-completion.js";
import type { OwnershipScope } from "./index.js";

export interface CaptureCollectionControlRecord extends CaptureCollectionControlState {
  tenantId: string;
  userId: string;
  automationId: string;
  captureSessionId: string;
  updatedAt: string;
}

export interface CaptureCollectionControlStore extends CaptureCollectionControl {
  putInitial(record: CaptureCollectionControlRecord): Promise<void>;
  startWorkflow(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY">;
  markReady(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY">;
  requestFinish(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY">;
}

export interface CaptureCollectionControlCommand {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
}

function assertRecordOwned(scope: OwnershipScope, record: CaptureCollectionControlRecord): void {
  if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
    throw new Error("capture collection control ownership mismatch");
  }
}

function recordKey(scope: OwnershipScope, captureSessionId: string): string {
  return `${scope.tenantId}:${scope.userId}:${captureSessionId}`;
}

export class CaptureCollectionControlService {
  private readonly now: () => Date;

  constructor(
    private readonly sessions: CaptureSessionStore,
    private readonly controls: CaptureCollectionControlStore,
    now: () => Date = () => new Date(),
  ) {
    this.now = now;
  }

  private async assertActive(command: CaptureCollectionControlCommand): Promise<void> {
    const session = await this.sessions.get(command.scope, command.captureSessionId);
    if (!session) throw new Error("capture session not found");
    if (session.tenantId !== command.scope.tenantId || session.userId !== command.scope.userId) {
      throw new Error("capture session ownership does not match scope");
    }
    if (session.automationId !== command.automationId) {
      throw new Error("capture session belongs to another automation");
    }
    if (session.status !== "STARTED") throw new Error("capture session is not active");
    const expiresAt = new Date(session.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
      throw new Error("capture session expired");
    }
  }

  async startWorkflow(command: CaptureCollectionControlCommand): Promise<"UPDATED" | "REPLAY"> {
    await this.assertActive(command);
    return this.controls.startWorkflow(command.scope, command.captureSessionId, this.now().toISOString());
  }

  async finish(command: CaptureCollectionControlCommand): Promise<"UPDATED" | "REPLAY"> {
    await this.assertActive(command);
    return this.controls.requestFinish(command.scope, command.captureSessionId, this.now().toISOString());
  }

  async getState(command: CaptureCollectionControlCommand): Promise<CaptureCollectionControlState> {
    await this.assertActive(command);
    return this.controls.getState(command.scope, command.captureSessionId);
  }
}

export class InMemoryCaptureCollectionControlStore implements CaptureCollectionControlStore {
  private readonly records = new Map<string, CaptureCollectionControlRecord>();

  async putInitial(record: CaptureCollectionControlRecord): Promise<void> {
    if (record.phase !== "AUTH_SETUP" || record.finishRequested) {
      throw new Error("initial capture control must begin in AUTH_SETUP without finish requested");
    }
    const scope = { tenantId: record.tenantId, userId: record.userId };
    const key = recordKey(scope, record.captureSessionId);
    if (this.records.has(key)) throw new Error("capture collection control already exists");
    this.records.set(key, structuredClone(record));
  }

  async getState(scope: OwnershipScope, captureSessionId: string): Promise<CaptureCollectionControlState> {
    const record = this.records.get(recordKey(scope, captureSessionId));
    if (!record) throw new Error("capture collection control not found");
    assertRecordOwned(scope, record);
    return {
      phase: record.phase,
      finishRequested: record.finishRequested,
      ...(record.collectorReady !== undefined ? { collectorReady: record.collectorReady } : {}),
    };
  }

  async startWorkflow(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY"> {
    const key = recordKey(scope, captureSessionId);
    const record = this.records.get(key);
    if (!record) throw new Error("capture collection control not found");
    assertRecordOwned(scope, record);
    if (record.finishRequested) throw new Error("capture collection is already finishing");
    if (record.phase === "WORKFLOW") return "REPLAY";
    this.records.set(key, {
      ...record,
      phase: "WORKFLOW",
      ...(record.collectorReady !== undefined ? { collectorReady: false } : {}),
      updatedAt,
    });
    return "UPDATED";
  }

  async markReady(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY"> {
    const key = recordKey(scope, captureSessionId);
    const record = this.records.get(key);
    if (!record) throw new Error("capture collection control not found");
    assertRecordOwned(scope, record);
    if (record.phase !== "WORKFLOW") throw new Error("capture collector cannot become ready before workflow recording starts");
    if (record.finishRequested) throw new Error("capture collection is already finishing");
    if (record.collectorReady === true) return "REPLAY";
    this.records.set(key, { ...record, collectorReady: true, updatedAt });
    return "UPDATED";
  }

  async requestFinish(scope: OwnershipScope, captureSessionId: string, updatedAt: string): Promise<"UPDATED" | "REPLAY"> {
    const key = recordKey(scope, captureSessionId);
    const record = this.records.get(key);
    if (!record) throw new Error("capture collection control not found");
    assertRecordOwned(scope, record);
    if (record.phase !== "WORKFLOW") throw new Error("workflow recording must start before capture can finish");
    if (record.finishRequested) return "REPLAY";
    // Legacy/local controls that predate the readiness bit remain usable. Production AWS
    // controls always persist an explicit false/true value and therefore fail closed here.
    if (record.collectorReady === false) throw new Error("capture collector is not ready");
    this.records.set(key, { ...record, finishRequested: true, updatedAt });
    return "UPDATED";
  }
}

export function initialCaptureCollectionControlRecord(input: {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
  updatedAt: string;
}): CaptureCollectionControlRecord {
  return {
    tenantId: input.scope.tenantId,
    userId: input.scope.userId,
    automationId: input.automationId,
    captureSessionId: input.captureSessionId,
    phase: "AUTH_SETUP",
    finishRequested: false,
    updatedAt: input.updatedAt,
  };
}

export function isCaptureCollectionPhase(value: unknown): value is CaptureCollectionPhase {
  return value === "AUTH_SETUP" || value === "WORKFLOW";
}
