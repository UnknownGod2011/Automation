import {
  assertWorkflowGraph,
  type RunCheckpoint,
  type RunFailure,
  type RunRecord,
  type RetryPolicy,
  type WorkflowGraph,
  type WorkflowNode,
} from "@automation/contracts";
import type {
  BrowserActionResult,
  BrowserExecutor,
  CheckpointRepository,
  OwnershipScope,
  ReasoningDecision,
  ReasoningProvider,
  RunRepository,
  VerificationEngine,
} from "./index.js";
import { classifyExecutionError } from "./errors.js";
import { transitionRun } from "./run-state.js";

const SEMANTIC_RECOVERABLE_FAILURES = new Set<RunFailure["code"]>([
  "ELEMENT_NOT_FOUND",
  "EFFECT_NOT_VERIFIED",
]);

const HUMAN_FAILURES = new Set<RunFailure["code"]>([
  "PROVIDER_AUTH_INVALID",
  "PROVIDER_QUOTA_EXHAUSTED",
  "TARGET_AUTH_REQUIRED",
  "POLICY_BLOCKED",
  "HUMAN_DECISION_REQUIRED",
  "NOT_CONFIGURED",
]);

export interface ExecutionEngineDependencies {
  browser: BrowserExecutor;
  reasoner: ReasoningProvider;
  verifier: VerificationEngine;
  checkpoints: CheckpointRepository;
  runs: RunRepository;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  jitter?: () => number;
  repeatedFingerprintLimit?: number;
  maxNodeExecutions?: number;
}

export interface ExecuteWorkflowRequest {
  scope: OwnershipScope;
  run: RunRecord;
  graph: WorkflowGraph;
  resumeFromHuman?: boolean;
}

export interface ExecutionResult {
  run: RunRecord;
  checkpoint: RunCheckpoint | null;
}

export interface RetryPlan {
  retry: boolean;
  delayMs: number;
}

export function failureFingerprint(
  nodeId: string,
  failure: RunFailure,
  stateFingerprint?: string,
): string {
  return `${nodeId}:${failure.code}:${stateFingerprint?.trim() || "unknown"}`;
}

export function planRetry(
  policy: RetryPolicy,
  failedAttempt: number,
  failure: RunFailure,
  jitterUnit = 0.5,
): RetryPlan {
  if (jitterUnit < 0 || jitterUnit > 1) {
    throw new Error("jitterUnit must be between 0 and 1");
  }

  const retry =
    failure.retryable &&
    policy.retryableFailureCodes.includes(failure.code) &&
    failedAttempt < policy.maxAttempts;

  if (!retry) return { retry: false, delayMs: 0 };

  const exponent = Math.max(0, failedAttempt - 1);
  const uncapped = policy.initialBackoffMs * 2 ** exponent;
  const capped = Math.min(policy.maxBackoffMs, uncapped);
  const delayMs = policy.jitter
    ? Math.round(capped * (0.5 + jitterUnit * 0.5))
    : capped;

  return { retry: true, delayMs };
}

function resolveInputs(
  node: WorkflowNode,
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const inputs: Record<string, unknown> = {};
  for (const [inputName, variableName] of Object.entries(node.inputBindings)) {
    if (Object.prototype.hasOwnProperty.call(variables, variableName)) {
      inputs[inputName] = variables[variableName];
    }
  }
  return inputs;
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

function nextNodeId(
  node: WorkflowNode,
  outputs: Readonly<Record<string, unknown>>,
): string | null {
  const candidates = node.next ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const selected = outputs.nextNodeId;
  if (typeof selected !== "string" || !candidates.includes(selected)) {
    throw new Error(
      `Node '${node.id}' must output nextNodeId matching one of its declared successors`,
    );
  }
  return selected;
}

function makeFailure(
  code: RunFailure["code"],
  message: string,
  nodeId: string,
  evidenceRefs: readonly string[],
  retryable: boolean,
): RunFailure {
  return { code, message, retryable, nodeId, evidenceRefs };
}

function failureResult(failure: RunFailure): BrowserActionResult {
  return {
    effectObserved: false,
    evidenceRefs: [...failure.evidenceRefs],
    outputs: {},
    failure,
  };
}

function semanticAllowedActions(node: WorkflowNode): readonly string[] {
  if (node.kind === "REASON") return node.allowedSideEffects;
  return [node.kind];
}

function validateDecision(
  node: WorkflowNode,
  decision: ReasoningDecision,
  allowedActions: readonly string[],
): RunFailure | null {
  if (!allowedActions.includes(decision.action)) {
    return makeFailure(
      "POLICY_BLOCKED",
      `Reasoning action '${decision.action}' is outside node '${node.id}' constraints`,
      node.id,
      [],
      false,
    );
  }

  if (
    !Number.isFinite(decision.confidence) ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    return makeFailure(
      "POLICY_BLOCKED",
      `Reasoning confidence for node '${node.id}' is invalid`,
      node.id,
      [],
      false,
    );
  }

  return null;
}

export class WorkflowExecutionEngine {
  private readonly now: () => Date;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly jitter: () => number;
  private readonly repeatedFingerprintLimit: number;
  private readonly maxNodeExecutions: number;

  constructor(private readonly dependencies: ExecutionEngineDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.sleep =
      dependencies.sleep ??
      (async (delayMs) => {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      });
    this.jitter = dependencies.jitter ?? Math.random;
    this.repeatedFingerprintLimit = dependencies.repeatedFingerprintLimit ?? 2;
    this.maxNodeExecutions = dependencies.maxNodeExecutions ?? 1_000;

    if (this.repeatedFingerprintLimit < 2) {
      throw new Error("repeatedFingerprintLimit must be at least 2");
    }
    if (this.maxNodeExecutions < 1) {
      throw new Error("maxNodeExecutions must be positive");
    }
  }

  async execute(request: ExecuteWorkflowRequest): Promise<ExecutionResult> {
    assertWorkflowGraph(request.graph);
    this.assertRunMatchesGraph(request.run, request.graph);

    let run = request.run;
    let checkpoint = await this.dependencies.checkpoints.get(request.scope, run.runId);
    this.assertCheckpointMatchesRun(checkpoint, run);

    if (run.status === "WAITING_FOR_HUMAN") {
      if (!request.resumeFromHuman) {
        throw new Error("WAITING_FOR_HUMAN run requires resumeFromHuman=true");
      }
      run = transitionRun(run, "RUNNING", {
        now: this.now().toISOString(),
        ...(checkpoint ? { currentNodeId: checkpoint.currentNodeId } : {}),
      });
      await this.dependencies.runs.update(run);
    } else if (run.status === "RETRYING") {
      run = transitionRun(run, "RUNNING", {
        now: this.now().toISOString(),
        ...(checkpoint ? { currentNodeId: checkpoint.currentNodeId } : {}),
      });
      await this.dependencies.runs.update(run);
    } else if (run.status !== "RUNNING") {
      throw new Error(
        `execution engine requires RUNNING, RETRYING, or WAITING_FOR_HUMAN run; received ${run.status}`,
      );
    }

    let currentNodeId = checkpoint?.currentNodeId ?? request.graph.entryNodeId;
    let completedNodeIds = [...(checkpoint?.completedNodeIds ?? [])];
    let variables: Readonly<Record<string, unknown>> = checkpoint?.variables ?? {};
    let evidenceRefs = [...(checkpoint?.evidenceRefs ?? [])];
    let attempt = request.resumeFromHuman ? 0 : (checkpoint?.attempt ?? 0);
    let previousFingerprint = request.resumeFromHuman
      ? undefined
      : checkpoint?.stateFingerprint;
    let fingerprintRepeatCount = request.resumeFromHuman
      ? 0
      : (checkpoint?.fingerprintRepeatCount ?? 0);

    for (
      let executionCount = 0;
      executionCount < this.maxNodeExecutions;
      executionCount += 1
    ) {
      const node = request.graph.nodes[currentNodeId];
      if (!node) {
        throw new Error(`checkpoint references missing node '${currentNodeId}'`);
      }

      if (node.kind === "END") {
        checkpoint = await this.putCheckpoint(
          request.scope,
          run,
          node.id,
          [...completedNodeIds, node.id],
          0,
          variables,
          evidenceRefs,
        );
        run = transitionRun(run, "SUCCEEDED", {
          now: this.now().toISOString(),
          currentNodeId: node.id,
        });
        await this.dependencies.runs.update(run);
        return { run, checkpoint };
      }

      if (node.kind === "HUMAN") {
        const humanFailure = makeFailure(
          "HUMAN_DECISION_REQUIRED",
          node.objective,
          node.id,
          evidenceRefs,
          false,
        );
        checkpoint = await this.putCheckpoint(
          request.scope,
          run,
          node.id,
          completedNodeIds,
          0,
          variables,
          evidenceRefs,
          undefined,
          0,
          humanFailure,
        );
        run = transitionRun(run, "WAITING_FOR_HUMAN", {
          now: this.now().toISOString(),
          currentNodeId: node.id,
        });
        await this.dependencies.runs.update(run);
        return { run, checkpoint };
      }

      attempt += 1;
      const inputs = resolveInputs(node, variables);
      let actionResult = await this.executeNode(
        request.scope,
        run,
        request.graph,
        node,
        inputs,
      );
      let nodeFailure = actionResult.failure;

      if (!nodeFailure && node.verification) {
        try {
          const verification = await this.dependencies.verifier.verify({
            scope: request.scope,
            runId: run.runId,
            node,
            verification: node.verification,
            outputs: actionResult.outputs,
            evidenceRefs: actionResult.evidenceRefs,
          });

          actionResult = {
            ...actionResult,
            evidenceRefs: [
              ...actionResult.evidenceRefs,
              ...verification.evidenceRefs,
            ],
          };

          if (!verification.verified) {
            nodeFailure = makeFailure(
              "EFFECT_NOT_VERIFIED",
              verification.detail,
              node.id,
              actionResult.evidenceRefs,
              true,
            );
          }
        } catch (error) {
          const failure = classifyExecutionError(
            error,
            node.id,
            "effect verification",
          );
          actionResult = {
            ...actionResult,
            evidenceRefs: [
              ...actionResult.evidenceRefs,
              ...failure.evidenceRefs,
            ],
          };
          nodeFailure = failure;
        }
      }

      if (!nodeFailure && node.allowedSideEffects.length > 0 && !node.verification) {
        nodeFailure = makeFailure(
          "EFFECT_NOT_VERIFIED",
          `Side-effecting node '${node.id}' has no verification contract`,
          node.id,
          actionResult.evidenceRefs,
          false,
        );
      }

      let successor: string | null = null;
      if (!nodeFailure) {
        try {
          successor = nextNodeId(node, actionResult.outputs);
        } catch {
          nodeFailure = makeFailure(
            "POLICY_BLOCKED",
            `Node '${node.id}' produced an invalid successor selection`,
            node.id,
            actionResult.evidenceRefs,
            false,
          );
        }
      }

      if (nodeFailure) {
        const fingerprint = failureFingerprint(
          node.id,
          nodeFailure,
          actionResult.stateFingerprint,
        );
        fingerprintRepeatCount =
          fingerprint === previousFingerprint ? fingerprintRepeatCount + 1 : 1;
        previousFingerprint = fingerprint;
        evidenceRefs = [...evidenceRefs, ...actionResult.evidenceRefs];

        checkpoint = await this.putCheckpoint(
          request.scope,
          run,
          node.id,
          completedNodeIds,
          attempt,
          variables,
          evidenceRefs,
          fingerprint,
          fingerprintRepeatCount,
          nodeFailure,
        );

        const retryPlan = planRetry(
          node.retryPolicy,
          attempt,
          nodeFailure,
          this.jitter(),
        );
        const repeatedFailure =
          fingerprintRepeatCount >= this.repeatedFingerprintLimit;

        if (retryPlan.retry && !repeatedFailure) {
          run = transitionRun(run, "RETRYING", {
            now: this.now().toISOString(),
            currentNodeId: node.id,
          });
          await this.dependencies.runs.update(run);
          if (retryPlan.delayMs > 0) {
            await this.sleep(retryPlan.delayMs);
          }
          run = transitionRun(run, "RUNNING", {
            now: this.now().toISOString(),
            currentNodeId: node.id,
          });
          await this.dependencies.runs.update(run);
          continue;
        }

        const shouldWaitForHuman =
          repeatedFailure ||
          node.escalation === "HUMAN" ||
          HUMAN_FAILURES.has(nodeFailure.code);

        if (shouldWaitForHuman) {
          run = transitionRun(run, "WAITING_FOR_HUMAN", {
            now: this.now().toISOString(),
            currentNodeId: node.id,
          });
          await this.dependencies.runs.update(run);
          return { run, checkpoint };
        }

        const terminalFailure =
          nodeFailure.retryable &&
          node.retryPolicy.retryableFailureCodes.includes(nodeFailure.code) &&
          attempt >= node.retryPolicy.maxAttempts
            ? makeFailure(
                "RETRY_BUDGET_EXHAUSTED",
                `Retry budget exhausted for node '${node.id}' after ${attempt} attempts; last failure: ${nodeFailure.code}`,
                node.id,
                evidenceRefs,
                false,
              )
            : nodeFailure;

        run = transitionRun(run, "FAILED", {
          now: this.now().toISOString(),
          currentNodeId: node.id,
          failure: terminalFailure,
        });
        await this.dependencies.runs.update(run);
        return { run, checkpoint };
      }

      variables = mergeOutputs(node, variables, actionResult.outputs);
      evidenceRefs = [...evidenceRefs, ...actionResult.evidenceRefs];

      if (!successor) {
        const terminalFailure = makeFailure(
          "UNKNOWN",
          `Node '${node.id}' completed without a successor or END node`,
          node.id,
          evidenceRefs,
          false,
        );
        checkpoint = await this.putCheckpoint(
          request.scope,
          run,
          node.id,
          completedNodeIds,
          attempt,
          variables,
          evidenceRefs,
          undefined,
          0,
          terminalFailure,
        );
        run = transitionRun(run, "FAILED", {
          now: this.now().toISOString(),
          currentNodeId: node.id,
          failure: terminalFailure,
        });
        await this.dependencies.runs.update(run);
        return { run, checkpoint };
      }

      completedNodeIds = [...completedNodeIds, node.id];
      currentNodeId = successor;
      attempt = 0;
      previousFingerprint = undefined;
      fingerprintRepeatCount = 0;

      checkpoint = await this.putCheckpoint(
        request.scope,
        run,
        currentNodeId,
        completedNodeIds,
        0,
        variables,
        evidenceRefs,
      );
      run = { ...run, currentNodeId };
      await this.dependencies.runs.update(run);
    }

    const terminalFailure = makeFailure(
      "RETRY_BUDGET_EXHAUSTED",
      `Workflow exceeded ${this.maxNodeExecutions} node executions`,
      currentNodeId,
      evidenceRefs,
      false,
    );
    checkpoint = await this.putCheckpoint(
      request.scope,
      run,
      currentNodeId,
      completedNodeIds,
      attempt,
      variables,
      evidenceRefs,
      previousFingerprint,
      fingerprintRepeatCount,
      terminalFailure,
    );
    run = transitionRun(run, "WAITING_FOR_HUMAN", {
      now: this.now().toISOString(),
      currentNodeId,
    });
    await this.dependencies.runs.update(run);
    return { run, checkpoint };
  }

  private async executeNode(
    scope: OwnershipScope,
    run: RunRecord,
    graph: WorkflowGraph,
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult> {
    if (node.kind === "REASON") {
      return this.executeSemantic(scope, run, graph, node, inputs);
    }

    let deterministic: BrowserActionResult;
    try {
      deterministic = await this.dependencies.browser.executeDeterministic(
        scope,
        run.runId,
        node,
        inputs,
      );
    } catch (error) {
      return failureResult(
        classifyExecutionError(
          error,
          node.id,
          "deterministic browser execution",
        ),
      );
    }

    if (
      !deterministic.failure ||
      node.escalation !== "SEMANTIC_RECOVERY" ||
      !SEMANTIC_RECOVERABLE_FAILURES.has(deterministic.failure.code)
    ) {
      return deterministic;
    }

    const semantic = await this.executeSemantic(scope, run, graph, node, inputs);
    return {
      ...semantic,
      evidenceRefs: [
        ...deterministic.evidenceRefs,
        ...semantic.evidenceRefs,
      ],
    };
  }

  private async executeSemantic(
    scope: OwnershipScope,
    run: RunRecord,
    graph: WorkflowGraph,
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult> {
    const allowedActions = semanticAllowedActions(node);
    if (allowedActions.length === 0) {
      return {
        effectObserved: false,
        evidenceRefs: [],
        outputs: {},
        failure: makeFailure(
          "POLICY_BLOCKED",
          `Node '${node.id}' has no allowed semantic actions`,
          node.id,
          [],
          false,
        ),
      };
    }

    let decision: ReasoningDecision;
    try {
      decision = await this.dependencies.reasoner.decide({
        scope,
        automationId: graph.automationId,
        runId: run.runId,
        node,
        objective: node.objective,
        context: inputs,
        allowedActions,
      });
    } catch (error) {
      return failureResult(
        classifyExecutionError(error, node.id, "semantic reasoning"),
      );
    }

    const invalidDecision = validateDecision(node, decision, allowedActions);
    if (invalidDecision) {
      return {
        effectObserved: false,
        evidenceRefs: [],
        outputs: {},
        failure: invalidDecision,
      };
    }

    try {
      return await this.dependencies.browser.executeSemantic(
        scope,
        run.runId,
        node,
        decision,
        inputs,
      );
    } catch (error) {
      return failureResult(
        classifyExecutionError(error, node.id, "semantic browser execution"),
      );
    }
  }

  private async putCheckpoint(
    scope: OwnershipScope,
    run: RunRecord,
    currentNodeId: string,
    completedNodeIds: readonly string[],
    attempt: number,
    variables: Readonly<Record<string, unknown>>,
    evidenceRefs: readonly string[],
    stateFingerprint?: string,
    fingerprintRepeatCount = 0,
    lastFailure?: RunFailure,
  ): Promise<RunCheckpoint> {
    const checkpoint: RunCheckpoint = {
      runId: run.runId,
      automationId: run.automationId,
      workflowVersion: run.workflowVersion,
      currentNodeId,
      completedNodeIds,
      attempt,
      fingerprintRepeatCount,
      variables,
      evidenceRefs,
      ...(stateFingerprint !== undefined ? { stateFingerprint } : {}),
      ...(lastFailure !== undefined ? { lastFailure } : {}),
      updatedAt: this.now().toISOString(),
    };

    await this.dependencies.checkpoints.put(scope, checkpoint);
    return checkpoint;
  }

  private assertRunMatchesGraph(run: RunRecord, graph: WorkflowGraph): void {
    if (run.automationId !== graph.automationId) {
      throw new Error("run automation does not match workflow graph");
    }
    if (run.workflowVersion !== graph.version) {
      throw new Error(
        "run workflow version does not match immutable graph version",
      );
    }
  }

  private assertCheckpointMatchesRun(
    checkpoint: RunCheckpoint | null,
    run: RunRecord,
  ): void {
    if (!checkpoint) return;
    if (
      checkpoint.runId !== run.runId ||
      checkpoint.automationId !== run.automationId ||
      checkpoint.workflowVersion !== run.workflowVersion
    ) {
      throw new Error("checkpoint identity does not match run");
    }
  }
}
