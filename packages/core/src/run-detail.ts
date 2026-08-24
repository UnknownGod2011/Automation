import type { RunCheckpoint, RunFailure, RunRecord, WorkflowGraph, WorkflowNode } from "@automation/contracts";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type {
  CheckpointRepository,
  OwnershipScope,
  RunRepository,
  WorkflowVersionRepository,
} from "./index.js";

export interface RunFailureView {
  code: RunFailure["code"];
  retryable: boolean;
  nodeId?: string;
  evidenceRefs: readonly string[];
}

export interface RunCheckpointView {
  currentNodeId: string;
  completedNodeIds: readonly string[];
  attempt: number;
  fingerprintRepeatCount: number;
  evidenceRefs: readonly string[];
  lastFailure?: RunFailureView;
  updatedAt: string;
}

export interface RunSemanticStepView {
  step: number;
  kind: WorkflowNode["kind"];
  objective: string;
}

export interface RunSemanticProgressView {
  current?: RunSemanticStepView;
  completed: readonly RunSemanticStepView[];
  failure?: RunSemanticStepView;
}

export interface RunDetailView {
  runId: string;
  automationId: string;
  workflowVersion: number;
  status: RunRecord["status"];
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentNodeId?: string;
  failure?: RunFailureView;
  checkpoint?: RunCheckpointView;
  semantic?: RunSemanticProgressView;
  needsHumanAttention: boolean;
  /** Read-only UX hint. Runtime validation remains the execution authority. */
  humanResumeEligible: boolean;
}

const MAX_REFERENCE_COUNT = 100;
const MAX_REFERENCE_LENGTH = 512;
const MAX_NODE_COUNT = 2_000;
const MAX_DISPLAY_TEXT_LENGTH = 4_096;

function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

function safeReferences(values: readonly string[]): readonly string[] {
  if (values.length > MAX_REFERENCE_COUNT) {
    throw new ControlPlaneError("CONFLICT", "run evidence state is invalid");
  }
  for (const value of values) {
    if (!value || value.length > MAX_REFERENCE_LENGTH) {
      throw new ControlPlaneError("CONFLICT", "run evidence state is invalid");
    }
  }
  return [...values];
}

function failureView(failure: RunFailure): RunFailureView {
  return {
    code: failure.code,
    retryable: failure.retryable,
    ...(failure.nodeId ? { nodeId: failure.nodeId } : {}),
    evidenceRefs: safeReferences(failure.evidenceRefs),
  };
}

function checkpointView(checkpoint: RunCheckpoint): RunCheckpointView {
  if (checkpoint.completedNodeIds.length > MAX_NODE_COUNT) {
    throw new ControlPlaneError("CONFLICT", "run checkpoint state is invalid");
  }
  return {
    currentNodeId: checkpoint.currentNodeId,
    completedNodeIds: [...checkpoint.completedNodeIds],
    attempt: checkpoint.attempt,
    fingerprintRepeatCount: checkpoint.fingerprintRepeatCount,
    evidenceRefs: safeReferences(checkpoint.evidenceRefs),
    ...(checkpoint.lastFailure ? { lastFailure: failureView(checkpoint.lastFailure) } : {}),
    updatedAt: checkpoint.updatedAt,
  };
}

function orderedNodeIds(graph: WorkflowGraph): readonly string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [graph.entryNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    ordered.push(nodeId);
    for (const successor of graph.nodes[nodeId]?.next ?? []) {
      if (!seen.has(successor)) queue.push(successor);
    }
  }
  for (const nodeId of Object.keys(graph.nodes).sort()) {
    if (!seen.has(nodeId)) ordered.push(nodeId);
  }
  return ordered;
}

function semanticProgress(
  graph: WorkflowGraph,
  run: RunRecord,
  checkpoint: RunCheckpoint | null,
): RunSemanticProgressView | undefined {
  if (graph.automationId !== run.automationId || graph.version !== run.workflowVersion) return undefined;
  const orderedIds = orderedNodeIds(graph);
  if (orderedIds.length === 0 || orderedIds.length > MAX_NODE_COUNT) return undefined;
  const stepByNodeId = new Map(orderedIds.map((nodeId, index) => [nodeId, index + 1] as const));

  const stepView = (nodeId: string | undefined): RunSemanticStepView | undefined => {
    if (!nodeId) return undefined;
    const node = graph.nodes[nodeId];
    const step = stepByNodeId.get(nodeId);
    if (!node || !step || !node.objective.trim() || node.objective.length > MAX_DISPLAY_TEXT_LENGTH) return undefined;
    return { step, kind: node.kind, objective: node.objective };
  };

  const currentNodeId = checkpoint?.currentNodeId ?? run.currentNodeId;
  const current = stepView(currentNodeId);
  if (currentNodeId && !current) return undefined;

  const completed: RunSemanticStepView[] = [];
  for (const completedNodeId of checkpoint?.completedNodeIds ?? []) {
    const view = stepView(completedNodeId);
    if (!view) return undefined;
    completed.push(view);
  }

  const failureNodeId = checkpoint?.lastFailure?.nodeId ?? run.failure?.nodeId;
  const failure = stepView(failureNodeId);
  if (failureNodeId && !failure) return undefined;

  return {
    ...(current ? { current } : {}),
    completed,
    ...(failure ? { failure } : {}),
  };
}

/**
 * Read-only user-facing run diagnostics. The view intentionally excludes workflow
 * variables, raw failure messages, state fingerprints, browser/profile state,
 * provider payloads, and evidence contents. When the immutable workflow is
 * available, semantic progress contains only step ordinal, kind, and objective;
 * selectors, bindings, expected values, and internal graph identifiers remain out
 * of that user-facing semantic projection.
 */
export class RunDetailService {
  constructor(
    private readonly runs: RunRepository,
    private readonly checkpoints: CheckpointRepository,
    private readonly workflows?: WorkflowVersionRepository,
  ) {}

  async get(
    scope: OwnershipScope,
    automationIdInput: string,
    runIdInput: string,
  ): Promise<RunDetailView> {
    const automationId = token(automationIdInput, "automationId");
    const runId = token(runIdInput, "runId");
    const run = await this.runs.get(scope, runId);
    if (!run || run.automationId !== automationId) {
      throw new ControlPlaneError("NOT_FOUND", "run not found");
    }

    const checkpoint = await this.checkpoints.get(scope, runId);
    if (
      checkpoint &&
      (checkpoint.runId !== run.runId ||
        checkpoint.automationId !== run.automationId ||
        checkpoint.workflowVersion !== run.workflowVersion)
    ) {
      throw new ControlPlaneError("CONFLICT", "run checkpoint identity is invalid");
    }

    let graph: WorkflowGraph | null = null;
    if (this.workflows) {
      try {
        const loaded = await this.workflows.get(scope, run.automationId, run.workflowVersion);
        if (loaded && loaded.automationId === run.automationId && loaded.version === run.workflowVersion) {
          graph = loaded;
        }
      } catch {
        // Run status/checkpoint diagnostics remain available during workflow-store
        // outages. Semantic display and HUMAN eligibility fail closed instead.
        graph = null;
      }
    }

    const nodeStateMatches = !run.currentNodeId || run.currentNodeId === checkpoint?.currentNodeId;
    let humanResumeEligible = false;
    if (
      run.status === "WAITING_FOR_HUMAN" &&
      checkpoint &&
      nodeStateMatches &&
      graph
    ) {
      const node = graph.nodes[checkpoint.currentNodeId];
      const successors = node?.next ?? [];
      humanResumeEligible =
        node?.kind === "HUMAN" &&
        successors.length === 1 &&
        Boolean(successors[0] && graph.nodes[successors[0]]);
    }

    const semantic = graph ? semanticProgress(graph, run, checkpoint) : undefined;

    return {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      status: run.status,
      scheduledAt: run.scheduledAt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.currentNodeId ? { currentNodeId: run.currentNodeId } : {}),
      ...(run.failure ? { failure: failureView(run.failure) } : {}),
      ...(checkpoint ? { checkpoint: checkpointView(checkpoint) } : {}),
      ...(semantic ? { semantic } : {}),
      needsHumanAttention: run.status === "WAITING_FOR_HUMAN",
      humanResumeEligible,
    };
  }
}

function parts(path: string): readonly string[] {
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

/** Adds GET /v1/automations/:automationId/runs/:runId without widening the base API service. */
export class RunDetailControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly details: RunDetailService,
  ) {}

  async handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse> {
    const route = parts(request.path);
    if (
      route[0] !== "v1" ||
      route[1] !== "automations" ||
      !route[2] ||
      route[3] !== "runs" ||
      !route[4] ||
      route.length !== 5
    ) {
      return this.base.handle(request, context);
    }

    if (request.method !== "GET") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }

    try {
      return {
        status: 200,
        body: await this.details.get(context.scope, route[2], route[4]),
      };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
