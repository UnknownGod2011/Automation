import {
  assertWorkflowGraph,
  type WorkflowGraph,
  type WorkflowNode,
} from "@automation/contracts";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type {
  AutomationRepository,
  OwnershipScope,
  WorkflowVersionRepository,
} from "./index.js";

const MAX_INSPECTION_NODES = 200;
const MAX_TEXT_LENGTH = 4_096;
const MAX_SIDE_EFFECTS = 32;
const MAX_SIDE_EFFECT_LENGTH = 160;
const MAX_CAPTURE_RUNTIME_INPUTS = 64;
const CAPTURE_RUNTIME_INPUT = /^capture_input_(?:[1-9]\d{0,3})$/;

export interface WorkflowVerificationInspectionView {
  mode: NonNullable<WorkflowNode["verification"]>["mode"];
  timeoutMs: number;
}

export interface WorkflowNodeInspectionView {
  step: number;
  kind: WorkflowNode["kind"];
  objective: string;
  allowedSideEffects: readonly string[];
  verification?: WorkflowVerificationInspectionView;
  maxAttempts: number;
  timeoutMs: number;
  escalation: WorkflowNode["escalation"];
  nextSteps: readonly number[];
  hasBoundInputs: boolean;
}

export interface WorkflowRuntimeInputInspectionView {
  /** Closed synthetic key emitted by the production capture collector, never a captured value. */
  key: string;
  step: number;
  /** Capture typed values are treated as sensitive unless a future explicit classification says otherwise. */
  treatAsSensitive: true;
}

export interface WorkflowInspectionView {
  version: number;
  objective: string;
  createdAt: string;
  published: boolean;
  totalNodeCount: number;
  truncated: boolean;
  nodes: readonly WorkflowNodeInspectionView[];
  runtimeInputs: readonly WorkflowRuntimeInputInspectionView[];
}

function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

function safeText(value: string): string {
  if (!value.trim() || value.length > MAX_TEXT_LENGTH) {
    throw new ControlPlaneError("CONFLICT", "compiled workflow contains invalid display metadata");
  }
  return value;
}

function safeSideEffects(values: readonly string[]): readonly string[] {
  if (values.length > MAX_SIDE_EFFECTS) {
    throw new ControlPlaneError("CONFLICT", "compiled workflow contains invalid side-effect metadata");
  }
  for (const value of values) {
    if (!value.trim() || value.length > MAX_SIDE_EFFECT_LENGTH) {
      throw new ControlPlaneError("CONFLICT", "compiled workflow contains invalid side-effect metadata");
    }
  }
  return [...values];
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

function runtimeInputs(
  graph: WorkflowGraph,
  orderedIds: readonly string[],
  stepByNodeId: ReadonlyMap<string, number>,
): readonly WorkflowRuntimeInputInspectionView[] {
  const initialVariables = graph.initialVariables ?? {};
  const seen = new Set<string>();
  const inputs: WorkflowRuntimeInputInspectionView[] = [];

  for (const nodeId of orderedIds) {
    const node = graph.nodes[nodeId];
    if (!node) throw new ControlPlaneError("CONFLICT", "compiled workflow state is invalid");
    const step = stepByNodeId.get(nodeId);
    if (!step) throw new ControlPlaneError("CONFLICT", "compiled workflow state is invalid");

    for (const variableName of Object.values(node.inputBindings)) {
      if (!CAPTURE_RUNTIME_INPUT.test(variableName)) continue;
      if (Object.prototype.hasOwnProperty.call(initialVariables, variableName)) continue;
      if (seen.has(variableName)) continue;
      if (inputs.length >= MAX_CAPTURE_RUNTIME_INPUTS) {
        throw new ControlPlaneError("CONFLICT", "compiled workflow has too many runtime inputs to inspect safely");
      }
      seen.add(variableName);
      inputs.push({ key: variableName, step, treatAsSensitive: true });
    }
  }

  return inputs;
}

function inspectionView(graph: WorkflowGraph): WorkflowInspectionView {
  try {
    assertWorkflowGraph(graph);
  } catch {
    throw new ControlPlaneError("CONFLICT", "compiled workflow state is invalid");
  }

  const orderedIds = orderedNodeIds(graph);
  const stepByNodeId = new Map(orderedIds.map((nodeId, index) => [nodeId, index + 1] as const));
  const visibleIds = orderedIds.slice(0, MAX_INSPECTION_NODES);
  const nodes = visibleIds.map((nodeId, index): WorkflowNodeInspectionView => {
    const node = graph.nodes[nodeId];
    if (!node) throw new ControlPlaneError("CONFLICT", "compiled workflow state is invalid");
    const nextSteps = (node.next ?? []).map((nextNodeId) => {
      const step = stepByNodeId.get(nextNodeId);
      if (!step) throw new ControlPlaneError("CONFLICT", "compiled workflow state is invalid");
      return step;
    });
    return {
      step: index + 1,
      kind: node.kind,
      objective: safeText(node.objective),
      allowedSideEffects: safeSideEffects(node.allowedSideEffects),
      ...(node.verification
        ? { verification: { mode: node.verification.mode, timeoutMs: node.verification.timeoutMs } }
        : {}),
      maxAttempts: node.retryPolicy.maxAttempts,
      timeoutMs: node.timeoutMs,
      escalation: node.escalation,
      nextSteps,
      hasBoundInputs: Object.keys(node.inputBindings).length > 0,
    };
  });

  return {
    version: graph.version,
    objective: safeText(graph.objective),
    createdAt: graph.createdAt,
    published: graph.publishedAt !== undefined,
    totalNodeCount: orderedIds.length,
    truncated: orderedIds.length > visibleIds.length,
    nodes,
    runtimeInputs: runtimeInputs(graph, orderedIds, stepByNodeId),
  };
}

/**
 * Read-only inspection of the latest compiled semantic workflow. The response
 * intentionally excludes workflow/node identifiers, deterministic selectors,
 * arbitrary input/output binding names or values, initial variables, verification
 * expected values/descriptions, and retry failure-code lists. The only binding
 * names exposed are unresolved capture-generated `capture_input_N` placeholders;
 * these synthetic keys contain no captured value and are required to make a
 * privacy-preserving fresh test actionable.
 */
export class WorkflowInspectionService {
  constructor(
    private readonly automations: AutomationRepository,
    private readonly workflows: WorkflowVersionRepository,
  ) {}

  async latest(scope: OwnershipScope, automationIdInput: string): Promise<WorkflowInspectionView | null> {
    const automationId = token(automationIdInput, "automationId");
    const automation = await this.automations.get(scope, automationId);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "automation not found");

    let versions: readonly WorkflowGraph[];
    try {
      versions = await this.workflows.list(scope, automationId);
    } catch {
      throw new ControlPlaneError("CONFLICT", "compiled workflow could not be inspected");
    }
    if (versions.length === 0) return null;

    const latest = [...versions].sort((left, right) => right.version - left.version)[0]!;
    if (latest.automationId !== automationId || !Number.isInteger(latest.version) || latest.version < 1) {
      throw new ControlPlaneError("CONFLICT", "compiled workflow identity is invalid");
    }
    return inspectionView(latest);
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
  return { status: 500, body: { error: { code: "INTERNAL", message: "control-plane request failed" } } };
}

/** Adds GET /v1/automations/:automationId/workflow as a read-only API surface. */
export class WorkflowInspectionControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly inspection: WorkflowInspectionService,
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
      route[3] !== "workflow" ||
      route.length !== 4
    ) {
      return this.base.handle(request, context);
    }
    if (request.method !== "GET") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }

    try {
      return {
        status: 200,
        body: { workflow: await this.inspection.latest(context.scope, route[2]) },
      };
    } catch (error) {
      return errorResponse(error);
    }
  }
}