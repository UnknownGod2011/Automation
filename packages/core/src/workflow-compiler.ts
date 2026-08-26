import {
  assertCaptureTrace,
  assertWorkflowGraph,
  type CaptureEvent,
  type CaptureSemanticTarget,
  type CaptureTrace,
  type DeterministicStrategy,
  type RetryPolicy,
  type VerificationSpec,
  type WorkflowGraph,
  type WorkflowNode,
} from "@automation/contracts";

export interface CompileCaptureRequest {
  trace: CaptureTrace;
  workflowId: string;
  version: number;
  createdAt: string;
}

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 4_000,
  jitter: true,
  retryableFailureCodes: ["TRANSIENT_NETWORK", "ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"],
};

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function strategiesForTarget(target: CaptureSemanticTarget | undefined): readonly DeterministicStrategy[] {
  if (!target) return [];
  const strategies: DeterministicStrategy[] = [];
  if (target.testId) strategies.push({ kind: "TEST_ID", value: target.testId, confidence: 1 });
  if (target.role) {
    strategies.push({
      kind: "ROLE",
      value: target.accessibleName ? `${target.role}:${target.accessibleName}` : target.role,
      confidence: 0.95,
    });
  }
  if (target.text) strategies.push({ kind: "TEXT", value: target.text, confidence: 0.85 });
  if (target.css) strategies.push({ kind: "CSS", value: target.css, confidence: 0.75 });
  if (target.xpath) strategies.push({ kind: "XPATH", value: target.xpath, confidence: 0.6 });
  return strategies;
}

function verificationFor(event: CaptureEvent): VerificationSpec {
  if (event.expectedEffect) return { ...event.expectedEffect };
  if (event.kind === "NAVIGATION" && event.navigationUrl) {
    return {
      description: `Browser reached ${event.navigationUrl}`,
      mode: "URL",
      expected: event.navigationUrl,
      timeoutMs: 15_000,
    };
  }
  throw new Error(`capture event '${event.eventId}' requires an expected effect before compilation`);
}

function navigationNode(id: string, url: string, nextNodeId: string): WorkflowNode {
  return {
    id,
    kind: "NAVIGATE",
    objective: `Navigate to ${url}`,
    deterministicStrategies: [{ kind: "URL", value: url, confidence: 1 }],
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: ["NAVIGATE"],
    verification: {
      description: `Browser reached ${url}`,
      mode: "URL",
      expected: url,
      timeoutMs: 15_000,
    },
    retryPolicy: DEFAULT_RETRY,
    timeoutMs: 30_000,
    next: [nextNodeId],
    escalation: "HUMAN",
  };
}

function objectiveFor(event: CaptureEvent): string {
  switch (event.kind) {
    case "NAVIGATION": return `Navigate to ${event.navigationUrl ?? event.page.url}`;
    case "CLICK": return `Activate captured target for event ${event.eventId}`;
    case "SUBMIT": return `Submit captured form for event ${event.eventId}`;
    case "INPUT": return `Enter captured input for event ${event.eventId}`;
    case "SCROLL": return `Observe scroll event ${event.eventId}`;
  }
}

function compileEvent(
  event: CaptureEvent,
  nodeId: string,
  nextNodeId: string,
  initialVariables: Record<string, unknown>,
): WorkflowNode {
  if (event.kind === "NAVIGATION") {
    const url = event.navigationUrl!;
    return {
      ...navigationNode(nodeId, url, nextNodeId),
      verification: verificationFor(event),
    };
  }

  const deterministicStrategies = strategiesForTarget(event.target);
  if (deterministicStrategies.length === 0) {
    throw new Error(`capture event '${event.eventId}' has no deterministic target strategy`);
  }

  if (event.kind === "INPUT") {
    if (event.inputControl !== undefined && event.inputControl !== "TEXT") {
      throw new Error(
        `capture input event '${event.eventId}' uses unsupported ${event.inputControl.toLowerCase()} control`,
      );
    }
    const input = event.input!;
    const variableName = input.kind === "PUBLIC_LITERAL"
      ? `capture.${event.eventId}.value`
      : input.variableName;
    if (input.kind === "PUBLIC_LITERAL") initialVariables[variableName] = input.value;
    return {
      id: nodeId,
      kind: "TYPE",
      objective: objectiveFor(event),
      deterministicStrategies,
      inputBindings: { value: variableName },
      outputBindings: {},
      allowedSideEffects: ["TYPE"],
      verification: verificationFor(event),
      retryPolicy: DEFAULT_RETRY,
      timeoutMs: 20_000,
      next: [nextNodeId],
      escalation: "SEMANTIC_RECOVERY",
    };
  }

  if (event.kind !== "CLICK" && event.kind !== "SUBMIT") {
    throw new Error(`capture event '${event.eventId}' is not executable`);
  }

  return {
    id: nodeId,
    kind: "CLICK",
    objective: objectiveFor(event),
    deterministicStrategies,
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: [event.kind === "SUBMIT" ? "SUBMIT" : "CLICK"],
    verification: verificationFor(event),
    retryPolicy: DEFAULT_RETRY,
    timeoutMs: 20_000,
    next: [nextNodeId],
    escalation: "SEMANTIC_RECOVERY",
  };
}

export function compileCaptureTrace(request: CompileCaptureRequest): WorkflowGraph {
  assertCaptureTrace(request.trace);
  required(request.workflowId, "workflowId");
  if (!Number.isInteger(request.version) || request.version < 1) throw new Error("workflow version must be a positive integer");
  if (Number.isNaN(new Date(request.createdAt).getTime())) throw new Error("createdAt must be an ISO-8601 timestamp");

  const executableEvents = request.trace.events.filter(
    (event) => event.purpose === "WORKFLOW" && event.kind !== "SCROLL",
  );
  if (executableEvents.length === 0) throw new Error("capture trace contains no executable workflow events");

  const nodes: Record<string, WorkflowNode> = {};
  const initialVariables: Record<string, unknown> = {};
  const eventNodeIds = executableEvents.map((event) => `capture-${event.sequence}-${event.eventId}`);
  const endNodeId = "end";

  executableEvents.forEach((event, index) => {
    nodes[eventNodeIds[index]!] = compileEvent(
      event,
      eventNodeIds[index]!,
      eventNodeIds[index + 1] ?? endNodeId,
      initialVariables,
    );
  });

  let entryNodeId = eventNodeIds[0]!;
  const firstEvent = executableEvents[0]!;
  if (firstEvent.kind !== "NAVIGATION") {
    entryNodeId = "capture-start";
    nodes[entryNodeId] = navigationNode(entryNodeId, firstEvent.page.url, eventNodeIds[0]!);
  }

  nodes[endNodeId] = {
    id: endNodeId,
    kind: "END",
    objective: "Workflow complete",
    deterministicStrategies: [],
    inputBindings: {},
    outputBindings: {},
    allowedSideEffects: [],
    retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
    timeoutMs: 1_000,
    escalation: "FAIL",
  };

  const graph: WorkflowGraph = {
    schemaVersion: 1,
    workflowId: request.workflowId,
    automationId: request.trace.automationId,
    version: request.version,
    entryNodeId,
    objective: request.trace.objective,
    nodes,
    initialVariables,
    createdAt: new Date(request.createdAt).toISOString(),
  };
  assertWorkflowGraph(graph);
  return graph;
}
