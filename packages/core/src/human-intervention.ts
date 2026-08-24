import type { RunRecord } from "@automation/contracts";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type { CheckpointRepository, OwnershipScope, RunRepository } from "./index.js";

const AUTHENTICATED_USER_RESOLUTION_ID = "authenticated-user-confirm-v1";

export interface HumanResumeSubmission {
  scope: OwnershipScope;
  automationId: string;
  runId: string;
  expectedNodeId: string;
  resolutionId: string;
}

export type HumanResumeSubmissionResult =
  | { kind: "RESUMED"; runId: string; status: RunRecord["status"] }
  | { kind: "DUPLICATE"; runId: string; status: RunRecord["status"] }
  | { kind: "BUSY"; runId: string; status: RunRecord["status"] }
  | { kind: "CONFLICT"; runId: string; status: RunRecord["status"] }
  | { kind: "NOT_WAITING"; runId: string; status: RunRecord["status"] };

/**
 * Execution-plane boundary for a user-confirmed explicit HUMAN workflow node.
 * Implementations must derive browser/model credentials from trusted execution
 * context rather than accepting them through this command payload.
 */
export interface HumanResumeExecutionPort {
  execute(request: HumanResumeSubmission): Promise<HumanResumeSubmissionResult>;
}

function token(value: string, name: string, max = 160): string {
  const normalized = value.trim();
  if (!normalized) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (normalized.length > max) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return normalized;
}

function durableNodeId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new ControlPlaneError("CONFLICT", "paused run checkpoint node identity is invalid");
  }
  return normalized;
}

/**
 * Authenticated control-plane guard around action-capable human resume. The paused
 * node is derived only from the latest durable checkpoint; browser/API request data
 * cannot choose it. Lease tokens, browser sessions, provider errors, branch
 * selection, and claim IDs remain outside this boundary.
 */
export class HumanResumeControlPlaneService {
  constructor(
    private readonly runs: RunRepository,
    private readonly checkpoints: CheckpointRepository,
    private readonly execution: HumanResumeExecutionPort,
  ) {}

  async resume(
    scope: OwnershipScope,
    automationIdInput: string,
    runIdInput: string,
  ): Promise<HumanResumeSubmissionResult> {
    const automationId = token(automationIdInput, "automationId");
    const runId = token(runIdInput, "runId");

    const run = await this.runs.get(scope, runId);
    if (!run || run.automationId !== automationId) {
      throw new ControlPlaneError("NOT_FOUND", "run not found");
    }
    if (run.status !== "WAITING_FOR_HUMAN") {
      return { kind: "NOT_WAITING", runId: run.runId, status: run.status };
    }

    const checkpoint = await this.checkpoints.get(scope, runId);
    if (!checkpoint) {
      throw new ControlPlaneError("CONFLICT", "paused run has no durable checkpoint");
    }
    if (
      checkpoint.runId !== run.runId ||
      checkpoint.automationId !== run.automationId ||
      checkpoint.workflowVersion !== run.workflowVersion
    ) {
      throw new ControlPlaneError("CONFLICT", "paused run checkpoint identity is invalid");
    }

    const expectedNodeId = durableNodeId(checkpoint.currentNodeId);
    if (run.currentNodeId && run.currentNodeId !== expectedNodeId) {
      throw new ControlPlaneError("CONFLICT", "paused run state does not match its checkpoint");
    }

    try {
      return await this.execution.execute({
        scope,
        automationId,
        runId,
        expectedNodeId,
        resolutionId: AUTHENTICATED_USER_RESOLUTION_ID,
      });
    } catch (error) {
      if (error instanceof ControlPlaneError) throw error;
      throw new ControlPlaneError("CONFLICT", "human resume could not be started");
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
    const status =
      error.code === "BAD_REQUEST"
        ? 400
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "NOT_CONFIGURED"
            ? 503
            : 409;
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "control-plane request failed" } },
  };
}

/** Adds POST /v1/automations/:automationId/runs/:runId/resume. */
export class HumanResumeControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly service: HumanResumeControlPlaneService,
  ) {}

  async handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse> {
    const route = pathParts(request.path);
    if (
      route[0] !== "v1" ||
      route[1] !== "automations" ||
      !route[2] ||
      route[3] !== "runs" ||
      !route[4] ||
      route[5] !== "resume" ||
      route.length !== 6
    ) {
      return this.base.handle(request, context);
    }
    if (request.method !== "POST") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }

    try {
      return {
        status: 200,
        body: await this.service.resume(context.scope, route[2], route[4]),
      };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
