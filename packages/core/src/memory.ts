import type {
  AutomationRecord,
  ProviderCredentialMetadata,
  RunCheckpoint,
  RunRecord,
  WorkflowGraph,
} from "@automation/contracts";
import type {
  ArtifactRef,
  ArtifactStore,
  AutomationLockManager,
  AutomationRepository,
  BrowserProfileStore,
  CheckpointRepository,
  CreateRunResult,
  CredentialMetadataRepository,
  CredentialSecret,
  CredentialVault,
  LockLease,
  NotificationMessage,
  NotificationPort,
  OwnershipScope,
  RunRepository,
  ScheduleRegistration,
  SchedulerPort,
  WorkflowVersionRepository,
} from "./index.js";

const scopeKey = (scope: OwnershipScope): string => `${scope.tenantId}:${scope.userId}`;
const ownedKey = (scope: OwnershipScope, id: string): string => `${scopeKey(scope)}:${id}`;
const automationOwnedKey = (scope: OwnershipScope, automationId: string, suffix: string): string =>
  `${ownedKey(scope, automationId)}:${suffix}`;

const clone = <T>(value: T): T => structuredClone(value);

const assertOwnership = (scope: OwnershipScope, tenantId: string, userId: string): void => {
  if (scope.tenantId !== tenantId || scope.userId !== userId) {
    throw new Error("record ownership does not match scope");
  }
};

export class InMemoryAutomationRepository implements AutomationRepository {
  private readonly records = new Map<string, AutomationRecord>();

  async get(scope: OwnershipScope, automationId: string): Promise<AutomationRecord | null> {
    const value = this.records.get(ownedKey(scope, automationId));
    return value ? clone(value) : null;
  }

  async put(record: AutomationRecord): Promise<void> {
    this.records.set(
      ownedKey({ tenantId: record.tenantId, userId: record.userId }, record.automationId),
      clone(record),
    );
  }

  async list(scope: OwnershipScope): Promise<readonly AutomationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === scope.tenantId && record.userId === scope.userId)
      .map(clone);
  }
}

export class InMemoryWorkflowVersionRepository implements WorkflowVersionRepository {
  private readonly records = new Map<string, WorkflowGraph>();

  async get(scope: OwnershipScope, automationId: string, version: number): Promise<WorkflowGraph | null> {
    const value = this.records.get(automationOwnedKey(scope, automationId, `v${version}`));
    return value ? clone(value) : null;
  }

  async putImmutable(scope: OwnershipScope, graph: WorkflowGraph): Promise<void> {
    const key = automationOwnedKey(scope, graph.automationId, `v${graph.version}`);
    if (this.records.has(key)) throw new Error(`workflow version ${graph.version} already exists`);
    this.records.set(key, clone(graph));
  }

  async list(scope: OwnershipScope, automationId: string): Promise<readonly WorkflowGraph[]> {
    const prefix = `${ownedKey(scope, automationId)}:v`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, graph]) => clone(graph))
      .sort((a, b) => a.version - b.version);
  }
}

export class InMemoryRunRepository implements RunRepository {
  private readonly byId = new Map<string, RunRecord>();
  private readonly occurrenceToRunId = new Map<string, string>();

  async createIfAbsent(run: RunRecord): Promise<CreateRunResult> {
    const scope = { tenantId: run.tenantId, userId: run.userId };
    const occurrenceKey = ownedKey(scope, run.occurrenceKey);
    const existingRunId = this.occurrenceToRunId.get(occurrenceKey);
    if (existingRunId) {
      const existing = this.byId.get(ownedKey(scope, existingRunId));
      if (!existing) throw new Error("run occurrence index is inconsistent");
      return { created: false, run: clone(existing) };
    }

    const runKey = ownedKey(scope, run.runId);
    if (this.byId.has(runKey)) throw new Error(`run '${run.runId}' already exists with another occurrence`);
    this.byId.set(runKey, clone(run));
    this.occurrenceToRunId.set(occurrenceKey, run.runId);
    return { created: true, run: clone(run) };
  }

  async get(scope: OwnershipScope, runId: string): Promise<RunRecord | null> {
    const value = this.byId.get(ownedKey(scope, runId));
    return value ? clone(value) : null;
  }

  async update(run: RunRecord): Promise<void> {
    const scope = { tenantId: run.tenantId, userId: run.userId };
    const key = ownedKey(scope, run.runId);
    const existing = this.byId.get(key);
    if (!existing) throw new Error(`run '${run.runId}' does not exist`);
    if (existing.occurrenceKey !== run.occurrenceKey || existing.automationId !== run.automationId) {
      throw new Error("immutable run identity fields cannot be changed");
    }
    this.byId.set(key, clone(run));
  }

  async listForAutomation(scope: OwnershipScope, automationId: string): Promise<readonly RunRecord[]> {
    return [...this.byId.values()]
      .filter(
        (run) =>
          run.tenantId === scope.tenantId &&
          run.userId === scope.userId &&
          run.automationId === automationId,
      )
      .map(clone)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }
}

export class InMemoryCheckpointRepository implements CheckpointRepository {
  private readonly records = new Map<string, RunCheckpoint>();

  async get(scope: OwnershipScope, runId: string): Promise<RunCheckpoint | null> {
    const value = this.records.get(ownedKey(scope, runId));
    return value ? clone(value) : null;
  }

  async put(scope: OwnershipScope, checkpoint: RunCheckpoint): Promise<void> {
    this.records.set(ownedKey(scope, checkpoint.runId), clone(checkpoint));
  }
}

interface LockRecord extends LockLease {
  scope: OwnershipScope;
}

export class InMemoryAutomationLockManager implements AutomationLockManager {
  private readonly locks = new Map<string, LockRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async acquire(
    scope: OwnershipScope,
    automationId: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<LockLease | null> {
    if (ttlMs <= 0) throw new Error("lock ttlMs must be positive");
    const key = ownedKey(scope, automationId);
    const existing = this.locks.get(key);
    const nowMs = this.now().getTime();
    if (existing && new Date(existing.expiresAt).getTime() > nowMs && existing.ownerToken !== ownerToken) {
      return null;
    }

    const lease: LockRecord = {
      scope: clone(scope),
      automationId,
      ownerToken,
      expiresAt: new Date(nowMs + ttlMs).toISOString(),
    };
    this.locks.set(key, lease);
    return clone(lease);
  }

  async release(scope: OwnershipScope, lease: LockLease): Promise<void> {
    const key = ownedKey(scope, lease.automationId);
    const existing = this.locks.get(key);
    if (!existing) return;
    if (existing.ownerToken !== lease.ownerToken) throw new Error("lock lease is not owned by caller");
    this.locks.delete(key);
  }
}

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly records = new Map<string, { ref: ArtifactRef; bytes: Uint8Array }>();

  async put(
    scope: OwnershipScope,
    path: string,
    content: Uint8Array,
    contentType: string,
  ): Promise<ArtifactRef> {
    const normalized = path.replace(/^\/+/, "");
    if (!normalized) throw new Error("artifact path is required");
    const ref = `memory://${scopeKey(scope)}/${normalized}`;
    const metadata: ArtifactRef = { ref, contentType, sizeBytes: content.byteLength };
    this.records.set(ownedKey(scope, ref), { ref: metadata, bytes: Uint8Array.from(content) });
    return clone(metadata);
  }

  async get(scope: OwnershipScope, ref: string): Promise<Uint8Array | null> {
    const value = this.records.get(ownedKey(scope, ref));
    return value ? Uint8Array.from(value.bytes) : null;
  }
}

export class InMemoryBrowserProfileStore implements BrowserProfileStore {
  private readonly profiles = new Set<string>();
  private counter = 0;

  async create(scope: OwnershipScope, automationId: string): Promise<string> {
    this.counter += 1;
    const ref = `memory-profile://${scopeKey(scope)}/${automationId}/${this.counter}`;
    this.profiles.add(ownedKey(scope, ref));
    return ref;
  }

  async exists(scope: OwnershipScope, profileRef: string): Promise<boolean> {
    return this.profiles.has(ownedKey(scope, profileRef));
  }

  async delete(scope: OwnershipScope, profileRef: string): Promise<void> {
    this.profiles.delete(ownedKey(scope, profileRef));
  }
}

export class InMemoryCredentialVault implements CredentialVault {
  private readonly secrets = new Map<string, CredentialSecret>();

  async put(scope: OwnershipScope, credentialId: string, secret: CredentialSecret): Promise<string> {
    if (!secret.value) throw new Error("credential secret cannot be empty");
    const ref = `memory-secret://${scopeKey(scope)}/${credentialId}`;
    this.secrets.set(ownedKey(scope, ref), clone(secret));
    return ref;
  }

  async get(scope: OwnershipScope, secretRef: string): Promise<CredentialSecret | null> {
    const value = this.secrets.get(ownedKey(scope, secretRef));
    return value ? clone(value) : null;
  }

  async delete(scope: OwnershipScope, secretRef: string): Promise<void> {
    this.secrets.delete(ownedKey(scope, secretRef));
  }
}

export class InMemoryCredentialMetadataRepository implements CredentialMetadataRepository {
  private readonly records = new Map<string, ProviderCredentialMetadata>();

  async put(metadata: ProviderCredentialMetadata): Promise<void> {
    const scope = { tenantId: metadata.tenantId, userId: metadata.userId };
    this.records.set(ownedKey(scope, metadata.credentialId), clone(metadata));
  }

  async get(scope: OwnershipScope, credentialId: string): Promise<ProviderCredentialMetadata | null> {
    const value = this.records.get(ownedKey(scope, credentialId));
    return value ? clone(value) : null;
  }

  async list(scope: OwnershipScope): Promise<readonly ProviderCredentialMetadata[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === scope.tenantId && record.userId === scope.userId)
      .map(clone)
      .sort((a, b) => a.priority - b.priority);
  }
}

export class InMemoryScheduler implements SchedulerPort {
  private readonly records = new Map<string, ScheduleRegistration>();

  async upsert(scope: OwnershipScope, registration: ScheduleRegistration): Promise<void> {
    this.records.set(ownedKey(scope, registration.scheduleId), clone(registration));
  }

  async delete(scope: OwnershipScope, scheduleId: string): Promise<void> {
    this.records.delete(ownedKey(scope, scheduleId));
  }

  async get(scope: OwnershipScope, scheduleId: string): Promise<ScheduleRegistration | null> {
    const value = this.records.get(ownedKey(scope, scheduleId));
    return value ? clone(value) : null;
  }
}

export class InMemoryNotificationPort implements NotificationPort {
  readonly messages: NotificationMessage[] = [];

  async send(scope: OwnershipScope, message: NotificationMessage): Promise<void> {
    if (scope.userId !== message.recipientUserId) throw new Error("notification recipient must match scope user");
    this.messages.push(clone(message));
  }
}

export function assertRecordOwnership(scope: OwnershipScope, record: AutomationRecord | RunRecord): void {
  assertOwnership(scope, record.tenantId, record.userId);
}
