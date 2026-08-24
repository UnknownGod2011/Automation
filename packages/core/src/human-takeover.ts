import type { AutomationRecord, RunCheckpoint, RunRecord } from "@automation/contracts";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type {
  AutomationRepository,
  CheckpointRepository,
  OwnershipScope,
  RunRepository,
} from "./index.js";
import type {
  HumanResumeControlPlaneService,
  HumanResumeSubmissionResult,
} from "./human-intervention.js";

const MAX_ID_LENGTH = 160;
const MAX_LIVE_VIEW_URL_LENGTH = 4_096;

export interface HumanTakeoverSessionRecord {
  tenantId: string;
  userId: string;
  automationId: string;
  runId: string;
  nodeId: string;
  takeoverId: string;
  browserSessionId: string;
  browserProfileRef: string;
  startedAt: string;
  expiresAt: string;
  status: "ACTIVE" | "COMPLETED";
  completedAt?: string;
}

export interface HumanTakeoverSessionStore {
  putStarted(record: HumanTakeoverSessionRecord, now: string): Promise<"CREATED" | "CONFLICT">;
  getForRun(scope: OwnershipScope, runId: string): Promise<HumanTakeoverSessionRecord | null>;
  complete(
    scope: OwnershipScope,
    runId: string,
    takeoverId: string,
    completedAt: string,
  ): Promise<"COMPLETED" | "REPLAY">;
}

export interface HumanTakeoverBrowserStartRequest {
  automationId: string;
  runId: string;
  takeoverId: string;
  profileRef: string;
}

export interface HumanTakeoverBrowserSession {
  browserSessionId: string;
  liveViewUrl: string;
  expiresAt: string;
}

/** Action-capable browser repair port. Implementations must never expose profile refs to clients. */
export interface HumanTakeoverBrowserPort {
  start(scope: OwnershipScope, request: HumanTakeoverBrowserStartRequest): Promise<HumanTakeoverBrowserSession>;
  liveView(scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<HumanTakeoverBrowserSession>;
  saveProfile(scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<void>;
  stop(scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<void>;
}

export interface HumanTakeoverStartResult {
  kind: "READY";
  liveViewUrl: string;
  expiresAt: string;
}

export interface HumanTakeoverServiceOptions {
  now?: () => Date;
  takeoverId?: () => string;
  onCleanupWarning?: (warning: string) => void;
}

function token(value: string, name: string, max = MAX_ID_LENGTH): string {
  const normalized = value.trim();
  if (!normalized) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (normalized.length > max) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return normalized;
}

function iso(value: string, name: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ControlPlaneError("CONFLICT", `${name} is invalid`);
  return parsed;
}

function validateLiveView(session: HumanTakeoverBrowserSession): HumanTakeoverStartResult {
  if (!session.browserSessionId.trim() || session.browserSessionId.length > 512) {
    throw new ControlPlaneError("CONFLICT", "repair browser session is invalid");
  }
  if (!session.liveViewUrl.trim() || session.liveViewUrl.length > MAX_LIVE_VIEW_URL_LENGTH) {
    throw new ControlPlaneError("CONFLICT", "repair Live View URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(session.liveViewUrl);
  } catch {
    throw new ControlPlaneError("CONFLICT", "repair Live View URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ControlPlaneError("CONFLICT", "repair Live View URL is unsafe");
  }
  iso(session.expiresAt, "repair Live View expiry");
  return { kind: "READY", liveViewUrl: url.toString(), expiresAt: session.expiresAt };
}

function sameScope(scope: OwnershipScope, record: HumanTakeoverSessionRecord): boolean {
  return record.tenantId === scope.tenantId && record.userId === scope.userId;
}

interface RepairBoundary {
  automation: AutomationRecord & { browserProfileRef: string };
  run: RunRecord;
  checkpoint: RunCheckpoint;
}

/**
 * Browser takeover for target-site authentication repair only. This does not broaden
 * generic human resolution: only a durable TARGET_AUTH_REQUIRED pause may open the
 * repair browser, and completion resumes the exact paused node through the existing
 * idempotent human-resolution authority.
 */
export class HumanTakeoverService {
  private readonly now: () => Date;
  private readonly takeoverId: () => string;
  private readonly onCleanupWarning: ((warning: string) => void) | undefined;

  constructor(
    private readonly automations: AutomationRepository,
    private readonly runs: RunRepository,
    private readonly checkpoints: CheckpointRepository,
    private readonly sessions: HumanTakeoverSessionStore,
    private readonly browser: HumanTakeoverBrowserPort,
    private readonly resume: HumanResumeControlPlaneService,
    options: HumanTakeoverServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.takeoverId = options.takeoverId ?? (() => globalThis.crypto.randomUUID());
    this.onCleanupWarning = options.onCleanupWarning;
  }

  async start(scope: OwnershipScope, automationIdInput: string, runIdInput: string): Promise<HumanTakeoverStartResult> {
    const boundary = await this.repairBoundary(scope, automationIdInput, runIdInput);
    const now = this.now();
    const existing = await this.sessions.getForRun(scope, boundary.run.runId);
    if (existing && existing.status === "ACTIVE" && iso(existing.expiresAt, "repair session expiry").getTime() > now.getTime()) {
      this.assertSessionBoundary(scope, boundary, existing);
      return validateLiveView(await this.browser.liveView(scope, existing));
    }

    const takeoverId = token(this.takeoverId(), "takeoverId", 512);
    const started = await this.browser.start(scope, {
      automationId: boundary.automation.automationId,
      runId: boundary.run.runId,
      takeoverId,
      profileRef: boundary.automation.browserProfileRef,
    });
    const record: HumanTakeoverSessionRecord = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: boundary.automation.automationId,
      runId: boundary.run.runId,
      nodeId: boundary.checkpoint.currentNodeId,
      takeoverId,
      browserSessionId: token(started.browserSessionId, "browserSessionId", 512),
      browserProfileRef: boundary.automation.browserProfileRef,
      startedAt: now.toISOString(),
      expiresAt: started.expiresAt,
      status: "ACTIVE",
    };

    const persisted = await this.sessions.putStarted(record, now.toISOString());
    if (persisted === "CONFLICT") {
      try {
        await this.browser.stop(scope, record);
      } catch {
        this.onCleanupWarning?.("discarded repair browser cleanup failed");
      }
      const winner = await this.sessions.getForRun(scope, boundary.run.runId);
      if (!winner || winner.status !== "ACTIVE" || iso(winner.expiresAt, "repair session expiry").getTime() <= now.getTime()) {
        throw new ControlPlaneError("CONFLICT", "another repair session changed concurrently");
      }
      this.assertSessionBoundary(scope, boundary, winner);
      return validateLiveView(await this.browser.liveView(scope, winner));
    }

    if (existing && existing.status === "ACTIVE") {
      try {
        await this.browser.stop(scope, existing);
      } catch {
        this.onCleanupWarning?.("expired repair browser cleanup failed");
      }
    }
    return validateLiveView(started);
  }

  async finish(
    scope: OwnershipScope,
    automationIdInput: string,
    runIdInput: string,
  ): Promise<HumanResumeSubmissionResult> {
    const boundary = await this.repairBoundary(scope, automationIdInput, runIdInput);
    const record = await this.sessions.getForRun(scope, boundary.run.runId);
    if (!record) throw new ControlPlaneError("CONFLICT", "no repair browser session exists for this run");
    this.assertSessionBoundary(scope, boundary, record);

    if (record.status === "ACTIVE") {
      if (iso(record.expiresAt, "repair session expiry").getTime() <= this.now().getTime()) {
        throw new ControlPlaneError("CONFLICT", "repair browser session expired before it was saved");
      }
      await this.browser.saveProfile(scope, record);
      await this.sessions.complete(scope, record.runId, record.takeoverId, this.now().toISOString());
      try {
        await this.browser.stop(scope, record);
      } catch {
        this.onCleanupWarning?.("completed repair browser cleanup failed");
      }
    }

    return this.resume.resume(scope, boundary.automation.automationId, boundary.run.runId, {
      expectedNodeId: boundary.checkpoint.currentNodeId,
    });
  }

  private async repairBoundary(scope: OwnershipScope, automationIdInput: string, runIdInput: string): Promise<RepairBoundary> {
    const automationId = token(automationIdInput, "automationId");
    const runId = token(runIdInput, "runId");
    const [automation, run, checkpoint] = await Promise.all([
      this.automations.get(scope, automationId),
      this.runs.get(scope, runId),
      this.checkpoints.get(scope, runId),
    ]);
    if (!automation || !run || run.automationId !== automationId) {
      throw new ControlPlaneError("NOT_FOUND", "run not found");
    }
    if (!checkpoint) throw new ControlPlaneError("CONFLICT", "paused run has no durable checkpoint");
    if (run.status !== "WAITING_FOR_HUMAN") {
      throw new ControlPlaneError("CONFLICT", "run is not waiting for human repair");
    }
    if (
      checkpoint.runId !== run.runId ||
      checkpoint.automationId !== run.automationId ||
      checkpoint.workflowVersion !== run.workflowVersion ||
      (run.currentNodeId !== undefined && run.currentNodeId !== checkpoint.currentNodeId)
    ) {
      throw new ControlPlaneError("CONFLICT", "paused run checkpoint identity is invalid");
    }
    if (
      checkpoint.lastFailure?.code !== "TARGET_AUTH_REQUIRED" ||
      checkpoint.lastFailure.nodeId !== checkpoint.currentNodeId
    ) {
      throw new ControlPlaneError("CONFLICT", "run does not require target-site authentication repair");
    }
    if (automation.status !== "ACTIVE") {
      throw new ControlPlaneError("CONFLICT", "automation is not active for repair");
    }
    const browserProfileRef = automation.browserProfileRef;
    if (!browserProfileRef) {
      throw new ControlPlaneError("CONFLICT", "automation has no browser profile to repair");
    }
    return { automation: { ...automation, browserProfileRef }, run, checkpoint };
  }

  private assertSessionBoundary(scope: OwnershipScope, boundary: RepairBoundary, record: HumanTakeoverSessionRecord): void {
    if (
      !sameScope(scope, record) ||
      record.automationId !== boundary.automation.automationId ||
      record.runId !== boundary.run.runId ||
      record.nodeId !== boundary.checkpoint.currentNodeId ||
      record.browserProfileRef !== boundary.automation.browserProfileRef
    ) {
      throw new ControlPlaneError("CONFLICT", "repair browser session identity is invalid");
    }
  }
}

function pathParts(path: string): readonly string[] {
  const clean = path.split("?", 1)[0] ?? "";
  try {
    return clean.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
}

function errorResponse(error: unknown): ControlPlaneHttpResponse {
  if (error instanceof ControlPlaneError) {
    const status = error.code === "BAD_REQUEST" ? 400 : error.code === "NOT_FOUND" ? 404 : 409;
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "control-plane request failed" } } };
}

/** Adds POST .../takeover/start and POST .../takeover/finish. */
export class HumanTakeoverControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly service: HumanTakeoverService,
  ) {}

  async handle(request: ControlPlaneHttpRequest, context: AuthenticatedControlPlaneContext): Promise<ControlPlaneHttpResponse> {
    const route = pathParts(request.path);
    if (
      route[0] !== "v1" || route[1] !== "automations" || !route[2] || route[3] !== "runs" || !route[4] ||
      route[5] !== "takeover" || !route[6] || route.length !== 7
    ) {
      return this.base.handle(request, context);
    }
    if (request.method !== "POST" || (route[6] !== "start" && route[6] !== "finish")) {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }
    try {
      return {
        status: 200,
        body: route[6] === "start"
          ? await this.service.start(context.scope, route[2], route[4])
          : await this.service.finish(context.scope, route[2], route[4]),
      };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
