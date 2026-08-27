export const AUTOMATION_STATUSES = [
  "DRAFT",
  "CAPTURING",
  "COMPILING",
  "READY_TO_TEST",
  "TESTING",
  "READY_TO_PUBLISH",
  "ACTIVE",
  "RUNNING",
  "PAUSED",
  "NEEDS_AUTH",
  "NEEDS_API_KEY",
  "NEEDS_ATTENTION",
  "DISABLED",
] as const;

export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const RUN_STATUSES = [
  "QUEUED",
  "PREFLIGHT",
  "RUNNING",
  "RETRYING",
  "WAITING_FOR_HUMAN",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "SKIPPED",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const WORKFLOW_NODE_KINDS = [
  "NAVIGATE",
  "CLICK",
  "TYPE",
  "SELECT",
  "CHECK",
  "EXTRACT",
  "REASON",
  "CONDITION",
  "LOOP",
  "VERIFY",
  "WAIT",
  "DOWNLOAD",
  "UPLOAD",
  "HUMAN",
  "SUBFLOW",
  "END",
] as const;

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

export const FAILURE_CODES = [
  "TRANSIENT_NETWORK",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_AUTH_INVALID",
  "PROVIDER_QUOTA_EXHAUSTED",
  "TARGET_AUTH_REQUIRED",
  "ELEMENT_NOT_FOUND",
  "EFFECT_NOT_VERIFIED",
  "POLICY_BLOCKED",
  "HUMAN_DECISION_REQUIRED",
  "RETRY_BUDGET_EXHAUSTED",
  "NOT_CONFIGURED",
  "UNKNOWN",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface RetryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitter: boolean;
  retryableFailureCodes: readonly FailureCode[];
}

export interface VerificationSpec {
  description: string;
  mode: "DOM" | "URL" | "TEXT" | "MODEL" | "CUSTOM";
  expected?: string;
  timeoutMs: number;
}

export interface DeterministicStrategy {
  kind: "ROLE" | "TEXT" | "TEST_ID" | "CSS" | "XPATH" | "URL" | "KEYBOARD";
  value: string;
  confidence?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  objective: string;
  deterministicStrategies: readonly DeterministicStrategy[];
  inputBindings: Readonly<Record<string, string>>;
  outputBindings: Readonly<Record<string, string>>;
  allowedSideEffects: readonly string[];
  verification?: VerificationSpec;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  next?: readonly string[];
  escalation: "FAIL" | "HUMAN" | "SEMANTIC_RECOVERY";
}

export interface WorkflowGraph {
  schemaVersion: 1;
  workflowId: string;
  automationId: string;
  version: number;
  entryNodeId: string;
  objective: string;
  nodes: Readonly<Record<string, WorkflowNode>>;
  initialVariables?: Readonly<Record<string, unknown>>;
  createdAt: string;
  publishedAt?: string;
}

export interface AutomationSchedule {
  kind: "HOURLY" | "DAILY" | "WEEKLY" | "CRON";
  expression: string;
  timezone: string;
}

export interface AutomationRecord {
  tenantId: string;
  userId: string;
  automationId: string;
  name: string;
  websiteUrl: string;
  prompt: string;
  status: AutomationStatus;
  publishedWorkflowVersion?: number;
  browserProfileRef?: string;
  schedule?: AutomationSchedule;
  /** Explicitly non-secret values persisted for unresolved capture_input_N bindings on scheduled runs. */
  scheduledNonSecretInputs?: Readonly<Record<string, string>>;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunFailure {
  code: FailureCode;
  message: string;
  retryable: boolean;
  nodeId?: string;
  evidenceRefs: readonly string[];
}

/**
 * Bounded, structured record of an accepted semantic decision. This intentionally
 * excludes provider free-form rationale, browser/page context, inputs, selectors,
 * and chain-of-thought. nodeId remains durable server-side identity and must be
 * translated to a semantic step ordinal before entering a user-facing response.
 */
export interface RunReasoningSummary {
  nodeId: string;
  trigger: "WORKFLOW_REASONING" | "SEMANTIC_RECOVERY";
  action: string;
  confidence: number;
}

export interface RunCheckpoint {
  runId: string;
  automationId: string;
  workflowVersion: number;
  currentNodeId: string;
  completedNodeIds: readonly string[];
  attempt: number;
  stateFingerprint?: string;
  fingerprintRepeatCount: number;
  variables: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly string[];
  reasoningSummaries?: readonly RunReasoningSummary[];
  lastFailure?: RunFailure;
  updatedAt: string;
}

export interface RunRecord {
  tenantId: string;
  userId: string;
  runId: string;
  automationId: string;
  workflowVersion: number;
  occurrenceKey: string;
  status: RunStatus;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentNodeId?: string;
  failure?: RunFailure;
}

export interface ProviderCredentialMetadata {
  tenantId: string;
  userId: string;
  credentialId: string;
  provider: string;
  secretRef: string;
  maskedLabel: string;
  status: "HEALTHY" | "COOLDOWN" | "DISABLED" | "EXHAUSTED" | "UNKNOWN";
  priority: number;
  cooldownUntil?: string;
  lastSuccessAt?: string;
  failureCount: number;
}

export function assertWorkflowGraph(graph: WorkflowGraph): void {
  if (!graph.nodes[graph.entryNodeId]) {
    throw new Error(`Workflow entry node '${graph.entryNodeId}' does not exist`);
  }

  for (const node of Object.values(graph.nodes)) {
    if (node.timeoutMs <= 0) {
      throw new Error(`Node '${node.id}' must have a positive timeout`);
    }
    if (node.retryPolicy.maxAttempts < 1) {
      throw new Error(`Node '${node.id}' must allow at least one attempt`);
    }
    if (node.retryPolicy.initialBackoffMs < 0 || node.retryPolicy.maxBackoffMs < 0) {
      throw new Error(`Node '${node.id}' retry backoff cannot be negative`);
    }
    if (
      node.retryPolicy.initialBackoffMs > node.retryPolicy.maxBackoffMs &&
      node.retryPolicy.maxAttempts > 1
    ) {
      throw new Error(`Node '${node.id}' initial retry backoff cannot exceed max backoff`);
    }
    if (node.allowedSideEffects.length > 0 && !node.verification) {
      throw new Error(`Node '${node.id}' has side effects but no verification contract`);
    }
    for (const nextNodeId of node.next ?? []) {
      if (!graph.nodes[nextNodeId]) {
        throw new Error(`Node '${node.id}' references missing node '${nextNodeId}'`);
      }
    }
  }
}

export function makeOccurrenceKey(automationId: string, scheduledAt: string): string {
  if (!automationId.trim()) throw new Error("automationId is required");
  const instant = new Date(scheduledAt);
  if (Number.isNaN(instant.getTime())) throw new Error("scheduledAt must be an ISO-8601 timestamp");
  return `${automationId}:${instant.toISOString()}`;
}

export * from "./capture.js";