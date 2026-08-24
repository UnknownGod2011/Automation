import type {
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import type { HumanResumeEffectRecord } from "./human-resume-effect.js";

export interface HumanResumeAppliedEffectReconstruction {
  outputs: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly string[];
  stateFingerprint?: string;
}

export interface HumanResumeAppliedEffectRecoveryRequest {
  run: RunRecord;
  checkpoint: RunCheckpoint;
  graph: WorkflowGraph;
  effect: HumanResumeEffectRecord;
  reconstruction: HumanResumeAppliedEffectReconstruction;
  now: string;
}

export interface HumanResumeAppliedEffectRecoveryPlan {
  checkpoint: RunCheckpoint;
  humanNode: WorkflowNode;
  successorNode: WorkflowNode;
  nextNodeId: string;
}

function instant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("now must be an ISO-8601 timestamp");
  return parsed.toISOString();
}

function appendCompleted(ids: readonly string[], nodeId: string): readonly string[] {
  return ids.includes(nodeId) ? [...ids] : [...ids, nodeId];
}

function mergeOutputs(
  node: WorkflowNode,
  variables: Readonly<Record<string, unknown>>,
  outputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const next = { ...variables };
  for (const [outputName, variableName] of Object.entries(node.outputBindings)) {
    if (Object.prototype.hasOwnProperty.call(outputs, outputName)) {
      next[variableName] = outputs[outputName];
    }
  }
  return next;
}

function resolveNextNodeId(
  node: WorkflowNode,
  outputs: Readonly<Record<string, unknown>>,
): string {
  const candidates = node.next ?? [];
  if (candidates.length === 1 && candidates[0]) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(`Reconciled successor '${node.id}' completed without a declared successor`);
  }

  const selected = outputs.nextNodeId;
  if (typeof selected !== "string" || !candidates.includes(selected)) {
    throw new Error(
      `Reconciled successor '${node.id}' must reconstruct nextNodeId matching one of its declared successors`,
    );
  }
  return selected;
}

function assertBoundary(request: HumanResumeAppliedEffectRecoveryRequest): {
  humanNode: WorkflowNode;
  successorNode: WorkflowNode;
} {
  const { run, checkpoint, graph, effect } = request;
  if (run.status !== "WAITING_FOR_HUMAN") {
    throw new Error("already-applied recovery requires a WAITING_FOR_HUMAN run");
  }
  if (
    checkpoint.runId !== run.runId ||
    checkpoint.automationId !== run.automationId ||
    checkpoint.workflowVersion !== run.workflowVersion ||
    run.automationId !== graph.automationId ||
    run.workflowVersion !== graph.version
  ) {
    throw new Error("already-applied recovery identity does not match durable run/checkpoint/workflow");
  }
  if (
    effect.tenantId !== run.tenantId ||
    effect.userId !== run.userId ||
    effect.runId !== run.runId ||
    effect.humanNodeId !== checkpoint.currentNodeId
  ) {
    throw new Error("already-applied effect does not match the paused ownership boundary");
  }
  if (effect.state !== "DECIDED" || effect.decision !== "ALREADY_APPLIED") {
    throw new Error("already-applied recovery requires a durable ALREADY_APPLIED decision");
  }

  const humanNode = graph.nodes[effect.humanNodeId];
  if (!humanNode || humanNode.kind !== "HUMAN") {
    throw new Error("already-applied recovery must originate from the paused HUMAN node");
  }
  const humanSuccessors = humanNode.next ?? [];
  if (humanSuccessors.length !== 1 || humanSuccessors[0] !== effect.successorNodeId) {
    throw new Error("already-applied effect successor does not match the HUMAN control-flow boundary");
  }

  const successorNode = graph.nodes[effect.successorNodeId];
  if (!successorNode) {
    throw new Error(`already-applied successor '${effect.successorNodeId}' is missing from workflow`);
  }
  if (successorNode.allowedSideEffects.length === 0 || !successorNode.verification) {
    throw new Error("already-applied recovery requires a side-effecting successor with verification");
  }

  return { humanNode, successorNode };
}

/**
 * Builds the exact checkpoint that ordinary successful execution would have produced
 * after the first resumed successor, without dispatching that successor again.
 *
 * This function is deliberately pure. The caller must still hold valid durable
 * execution ownership and persist the returned checkpoint/run transition using the
 * production recovery protocol. It is not execution permission by itself.
 */
export function planAlreadyAppliedHumanResumeRecovery(
  request: HumanResumeAppliedEffectRecoveryRequest,
): HumanResumeAppliedEffectRecoveryPlan {
  const { humanNode, successorNode } = assertBoundary(request);
  const nextNodeId = resolveNextNodeId(successorNode, request.reconstruction.outputs);
  if (!request.graph.nodes[nextNodeId]) {
    throw new Error(`reconstructed successor references missing node '${nextNodeId}'`);
  }

  let completedNodeIds = appendCompleted(request.checkpoint.completedNodeIds, humanNode.id);
  completedNodeIds = appendCompleted(completedNodeIds, successorNode.id);

  const checkpoint: RunCheckpoint = {
    runId: request.run.runId,
    automationId: request.run.automationId,
    workflowVersion: request.run.workflowVersion,
    currentNodeId: nextNodeId,
    completedNodeIds,
    attempt: 0,
    fingerprintRepeatCount: 0,
    variables: mergeOutputs(
      successorNode,
      request.checkpoint.variables,
      request.reconstruction.outputs,
    ),
    evidenceRefs: [
      ...request.checkpoint.evidenceRefs,
      ...request.reconstruction.evidenceRefs,
    ],
    updatedAt: instant(request.now),
  };

  return { checkpoint, humanNode, successorNode, nextNodeId };
}
