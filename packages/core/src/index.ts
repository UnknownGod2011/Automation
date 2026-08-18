import type {
  AutomationRecord,
  AutomationSchedule,
  ProviderCredentialMetadata,
  RunCheckpoint,
  RunFailure,
  RunRecord,
  VerificationSpec,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";

export interface OwnershipScope {
  tenantId: string;
  userId: string;
}

export interface AutomationRepository {
  get(scope: OwnershipScope, automationId: string): Promise<AutomationRecord | null>;
  put(record: AutomationRecord): Promise<void>;
  list(scope: OwnershipScope): Promise<readonly AutomationRecord[]>;
}

export interface WorkflowVersionRepository {
  get(scope: OwnershipScope, automationId: string, version: number): Promise<WorkflowGraph | null>;
  putImmutable(scope: OwnershipScope, graph: WorkflowGraph): Promise<void>;
  list(scope: OwnershipScope, automationId: string): Promise<readonly WorkflowGraph[]>;
}

export type CreateRunResult =
  | { created: true; run: RunRecord }
  | { created: false; run: RunRecord };

export interface RunRepository {
  createIfAbsent(run: RunRecord): Promise<CreateRunResult>;
  get(scope: OwnershipScope, runId: string): Promise<RunRecord | null>;
  update(run: RunRecord): Promise<void>;
  listForAutomation(scope: OwnershipScope, automationId: string): Promise<readonly RunRecord[]>;
}

export interface CheckpointRepository {
  get(scope: OwnershipScope, runId: string): Promise<RunCheckpoint | null>;
  put(scope: OwnershipScope, checkpoint: RunCheckpoint): Promise<void>;
}

export interface LockLease {
  automationId: string;
  ownerToken: string;
  expiresAt: string;
}

export interface AutomationLockManager {
  acquire(scope: OwnershipScope, automationId: string, ownerToken: string, ttlMs: number): Promise<LockLease | null>;
  release(scope: OwnershipScope, lease: LockLease): Promise<void>;
}

export interface ArtifactRef {
  ref: string;
  contentType: string;
  sizeBytes: number;
}

export interface ArtifactStore {
  put(scope: OwnershipScope, path: string, content: Uint8Array, contentType: string): Promise<ArtifactRef>;
  get(scope: OwnershipScope, ref: string): Promise<Uint8Array | null>;
}

export interface BrowserProfileStore {
  create(scope: OwnershipScope, automationId: string): Promise<string>;
  exists(scope: OwnershipScope, profileRef: string): Promise<boolean>;
  delete(scope: OwnershipScope, profileRef: string): Promise<void>;
}

export interface CredentialSecret {
  value: string;
}

export interface CredentialVault {
  put(scope: OwnershipScope, credentialId: string, secret: CredentialSecret): Promise<string>;
  get(scope: OwnershipScope, secretRef: string): Promise<CredentialSecret | null>;
  delete(scope: OwnershipScope, secretRef: string): Promise<void>;
}

export interface CredentialMetadataRepository {
  put(metadata: ProviderCredentialMetadata): Promise<void>;
  get(scope: OwnershipScope, credentialId: string): Promise<ProviderCredentialMetadata | null>;
  list(scope: OwnershipScope): Promise<readonly ProviderCredentialMetadata[]>;
}

export interface ScheduleRegistration {
  scheduleId: string;
  automationId: string;
  schedule: AutomationSchedule;
  enabled: boolean;
}

export interface SchedulerPort {
  upsert(scope: OwnershipScope, registration: ScheduleRegistration): Promise<void>;
  delete(scope: OwnershipScope, scheduleId: string): Promise<void>;
  get(scope: OwnershipScope, scheduleId: string): Promise<ScheduleRegistration | null>;
}

export interface NotificationMessage {
  kind: "RUN_SUCCEEDED" | "RUN_FAILED" | "NEEDS_ATTENTION" | "AUTH_REQUIRED" | "API_KEY_REQUIRED";
  recipientUserId: string;
  automationId: string;
  runId?: string;
  subject: string;
  body: string;
}

export interface NotificationPort {
  send(scope: OwnershipScope, message: NotificationMessage): Promise<void>;
}

export interface ReasoningRequest {
  scope: OwnershipScope;
  automationId: string;
  runId: string;
  node: WorkflowNode;
  objective: string;
  context: Readonly<Record<string, unknown>>;
  allowedActions: readonly string[];
}

export interface ReasoningDecision {
  summary: string;
  action: string;
  arguments: Readonly<Record<string, unknown>>;
  confidence: number;
}

export interface ReasoningProvider {
  decide(request: ReasoningRequest): Promise<ReasoningDecision>;
}

export interface BrowserActionResult {
  effectObserved: boolean;
  evidenceRefs: readonly string[];
  outputs: Readonly<Record<string, unknown>>;
  stateFingerprint?: string;
  failure?: RunFailure;
}

export interface BrowserExecutor {
  executeDeterministic(
    scope: OwnershipScope,
    runId: string,
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult>;
  executeSemantic(
    scope: OwnershipScope,
    runId: string,
    node: WorkflowNode,
    decision: ReasoningDecision,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult>;
}

export interface VerificationContext {
  scope: OwnershipScope;
  runId: string;
  node: WorkflowNode;
  verification: VerificationSpec;
  outputs: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly string[];
}

export interface VerificationResult {
  verified: boolean;
  evidenceRefs: readonly string[];
  detail: string;
}

export interface VerificationEngine {
  verify(context: VerificationContext): Promise<VerificationResult>;
}

export * from "./execution.js";
export * from "./memory.js";
export * from "./run-state.js";
