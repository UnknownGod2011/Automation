import type { CaptureSessionRecord } from "./capture-completion.js";
import type { CaptureCollectionControlService } from "./capture-control.js";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { OwnershipScope } from "./index.js";

export interface ActiveCaptureSessionReader {
  activeForAutomation(scope: OwnershipScope, automationId: string): Promise<CaptureSessionRecord | null>;
}

export type CaptureRecordingView =
  | { kind: "NONE" }
  | {
      kind: "ACTIVE";
      captureSessionId: string;
      phase: "AUTH_SETUP" | "WORKFLOW";
      finishRequested: boolean;
      expiresAt: string;
    };

export interface CaptureRecordingCommand {
  scope: OwnershipScope;
  automationId: string;
  captureSessionId: string;
}

function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

export class CaptureRecordingControlPlaneService {
  constructor(
    private readonly sessions: ActiveCaptureSessionReader,
    private readonly controls: Pick<CaptureCollectionControlService, "getState" | "startWorkflow" | "finish">,
  ) {}

  private async current(command: { scope: OwnershipScope; automationId: string }): Promise<CaptureSessionRecord | null> {
    const automationId = token(command.automationId, "automationId");
    const record = await this.sessions.activeForAutomation(command.scope, automationId);
    if (!record) return null;
    if (
      record.tenantId !== command.scope.tenantId ||
      record.userId !== command.scope.userId ||
      record.automationId !== automationId ||
      record.status !== "STARTED"
    ) {
      throw new ControlPlaneError("CONFLICT", "active capture state is invalid");
    }
    return record;
  }

  private async view(scope: OwnershipScope, record: CaptureSessionRecord): Promise<CaptureRecordingView> {
    const state = await this.controls.getState({
      scope,
      automationId: record.automationId,
      captureSessionId: record.captureSessionId,
    });
    return {
      kind: "ACTIVE",
      captureSessionId: record.captureSessionId,
      phase: state.phase,
      finishRequested: state.finishRequested,
      expiresAt: record.expiresAt,
    };
  }

  async state(scope: OwnershipScope, automationId: string): Promise<CaptureRecordingView> {
    try {
      const record = await this.current({ scope, automationId });
      return record ? await this.view(scope, record) : { kind: "NONE" };
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "capture recording state could not be read");
    }
  }

  private async requireCurrent(command: CaptureRecordingCommand): Promise<CaptureSessionRecord> {
    const automationId = token(command.automationId, "automationId");
    const captureSessionId = token(command.captureSessionId, "captureSessionId");
    const record = await this.current({ scope: command.scope, automationId });
    if (!record) throw new ControlPlaneError("NOT_FOUND", "active capture not found");
    if (record.captureSessionId !== captureSessionId) {
      throw new ControlPlaneError("CONFLICT", "capture command does not target the current session");
    }
    return record;
  }

  async startWorkflow(command: CaptureRecordingCommand): Promise<CaptureRecordingView> {
    const record = await this.requireCurrent(command);
    try {
      await this.controls.startWorkflow({
        scope: command.scope,
        automationId: record.automationId,
        captureSessionId: record.captureSessionId,
      });
      return await this.view(command.scope, record);
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "workflow recording could not be started");
    }
  }

  async finish(command: CaptureRecordingCommand): Promise<CaptureRecordingView> {
    const record = await this.requireCurrent(command);
    try {
      await this.controls.finish({
        scope: command.scope,
        automationId: record.automationId,
        captureSessionId: record.captureSessionId,
      });
      return await this.view(command.scope, record);
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "capture finish could not be requested");
    }
  }
}

export interface ControlPlaneHttpHandlerPort {
  handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse>;
}

function parts(path: string): readonly string[] {
  const clean = path.split("?", 1)[0] ?? "";
  try {
    return clean.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ControlPlaneError("BAD_REQUEST", "request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function captureId(value: unknown): string {
  if (typeof value !== "string") throw new ControlPlaneError("BAD_REQUEST", "captureSessionId must be a string");
  return token(value, "captureSessionId");
}

function errorResponse(error: unknown): ControlPlaneHttpResponse {
  if (error instanceof ControlPlaneError) {
    const status = error.code === "BAD_REQUEST" ? 400 : error.code === "NOT_FOUND" ? 404 : error.code === "NOT_CONFIGURED" ? 503 : 409;
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "control-plane request failed" } } };
}

export class CaptureAwareControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly capture: CaptureRecordingControlPlaneService,
  ) {}

  async handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse> {
    const route = parts(request.path);
    const automationId = route[2];
    if (route[0] !== "v1" || route[1] !== "automations" || !automationId || route[3] !== "capture-recording") {
      return this.base.handle(request, context);
    }

    try {
      if (request.method === "GET" && route.length === 4) {
        return { status: 200, body: await this.capture.state(context.scope, automationId) };
      }
      if (request.method === "POST" && route.length === 5 && (route[4] === "start" || route[4] === "finish")) {
        const body = bodyObject(request.body);
        const command = {
          scope: context.scope,
          automationId,
          captureSessionId: captureId(body.captureSessionId),
        };
        const result = route[4] === "start"
          ? await this.capture.startWorkflow(command)
          : await this.capture.finish(command);
        return { status: 200, body: result };
      }
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
