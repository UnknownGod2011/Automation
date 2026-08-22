import { describe, expect, it } from "vitest";
import type { AutomationRecord, RunCheckpoint, RunRecord, WorkflowGraph } from "@automation/contracts";
import {
  ScheduledRunCoordinator,
  type AutomationLockManager,
  type AutomationRepository,
  type BrowserProfileStore,
  type CheckpointRepository,
  type LockLease,
  type OwnershipScope,
  type RunPreflightCheck,
  type RunRepository,
  type WorkflowVersionRepository,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const automation = (overrides: Partial<AutomationRecord> = {}): AutomationRecord => ({
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  name: "Daily report",
  websiteUrl: "https://example.com",
  prompt: "Open the report",
  status: "ACTIVE",
  publishedWorkflowVersion: 1,
  browserProfileRef: "profile://1",
  notifyOnSuccess: false,
  notifyOnFailure: true,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  ...overrides,
});
const graph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "end",
  objective: "Finish",
  createdAt: "2026-08-18T00:00:00.000Z",
  nodes: {
    end: {
      id: "end",
      kind: "END",
      objective: "Finish",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
      timeoutMs: 1_000,
      escalation: "FAIL",
    },
  },
};
class AutomationRepo implements AutomationRepository {
  constructor(private readonly value: AutomationRecord | null) {}
  async get() { return this.value ? structuredClone(this.value) : null; }
  async put() {}
  async list() { return this.value ? [structuredClone(this.value)] : []; }
}
class WorkflowRepo implements WorkflowVersionRepository {
  constructor(private readonly value: WorkflowGraph | null) {}
  async get() { return this.value ? structuredClone(this.value) : null; }
  async putImmutable() {}
  async list() { return this.value ? [structuredClone(this.value)] : []; }
}
class Runs implements RunRepository {
  value: RunRecord | null = null;
  async createIfAbsent(run: RunRecord) { if (this.value) return { created: false as const, run: structuredClone(this.value) }; this.value = structuredClone(run); return { created: true as const, run: structuredClone(run) }; }
  async get() { return this.value ? structuredClone(this.value) : null; }
  async update(run: RunRecord) { this.value = structuredClone(run); }
  async listForAutomation() { return this.value ? [structuredClone(this.value)] : []; }
}
class Checkpoints implements CheckpointRepository {
  value: RunCheckpoint | null = null;
  async get() { return this.value ? structuredClone(this.value) : null; }
  async put(_: OwnershipScope, checkpoint: RunCheckpoint) { this.value = structuredClone(checkpoint); }
}
class Profiles implements BrowserProfileStore {
  constructor(private readonly present: boolean) {}
  async create() { return "profile://created"; }
  async exists() { return this.present; }
  async delete() {}
}
class Locks implements AutomationLockManager {
  lease: LockLease | null = null;
  renewCalls = 0;
  constructor(private readonly available = true) {}
  async acquire(_: OwnershipScope, automationId: string, ownerToken: string, ttlMs: number) { if (!this.available) return null; this.lease = { automationId, ownerToken, expiresAt: new Date(ttlMs).toISOString() }; return structuredClone(this.lease); }
  async renew(_: OwnershipScope, lease: LockLease, ttlMs: number) { this.renewCalls += 1; if (!this.lease || this.lease.ownerToken !== lease.ownerToken) return null; this.lease = { ...lease, expiresAt: new Date(ttlMs + 1).toISOString() }; return structuredClone(this.lease); }
  async release() { this.lease = null; }
}
function coordinator(options: { automation?: AutomationRecord; workflow?: WorkflowGraph | null; profilePresent?: boolean; lockAvailable?: boolean; preflightChecks?: readonly RunPreflightCheck[] } = {}) {
  const runs = new Runs();
  const locks = new Locks(options.lockAvailable ?? true);
  const checkpoints = new Checkpoints();
  return {
    locks,
    checkpoints,
    value: new ScheduledRunCoordinator({
      automations: new AutomationRepo(options.automation ?? automation()),
      workflows: new WorkflowRepo(options.workflow === undefined ? graph : options.workflow),
      runs,
      checkpoints,
      profiles: new Profiles(options.profilePresent ?? true),
      locks,
      preflightChecks: options.preflightChecks ?? [],
      now: () => new Date("2026-08-18T12:00:00.000Z"),
      lockTtlMs: 60_000,
    }),
  };
}
const request = { scope, automationId: "auto-1", scheduledAt: "2026-08-18T12:00:00.000Z", runId: "run-1" };
function inputWorkflow(): WorkflowGraph {
  return {
    ...graph,
    initialVariables: { "capture.literal": "Monthly report" },
    nodes: { ...graph.nodes, end: { ...graph.nodes.end!, inputBindings: { value: "capture_input_3" } } },
  };
}

describe("ScheduledRunCoordinator", () => {
  it("checkpoints compiled and persisted scheduled inputs before a scheduled browser run becomes READY", async () => {
    const { value, locks, checkpoints } = coordinator({
      workflow: inputWorkflow(),
      automation: automation({ scheduledNonSecretInputs: { capture_input_3: "ops-team" } }),
    });
    const result = await value.prepare(request);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") throw new Error("expected READY");
    expect(result.run.status).toBe("RUNNING");
    expect(checkpoints.value?.variables).toEqual({ "capture.literal": "Monthly report", capture_input_3: "ops-team" });
    const renewed = await value.renewLease(scope, result.lease);
    expect(renewed.ownerToken).toBe("run-1");
    expect(locks.renewCalls).toBe(1);
  });

  it("allows an explicit invocation value to override a persisted scheduled default", async () => {
    const { value, checkpoints } = coordinator({
      workflow: inputWorkflow(),
      automation: automation({ scheduledNonSecretInputs: { capture_input_3: "default-team" } }),
    });
    expect((await value.prepare({ ...request, runtimeVariables: { capture_input_3: "override-team" } })).kind).toBe("READY");
    expect(checkpoints.value?.variables.capture_input_3).toBe("override-team");
  });

  it("fails a legacy active workflow before browser work when a required scheduled input is missing", async () => {
    const { value, checkpoints } = coordinator({ workflow: inputWorkflow() });
    const result = await value.prepare(request);
    expect(result.kind).toBe("FAILED");
    expect(result.run.failure?.code).toBe("NOT_CONFIGURED");
    expect(checkpoints.value).toBeNull();
  });

  it("returns the existing run for duplicate at-least-once schedule delivery", async () => {
    const { value } = coordinator();
    expect((await value.prepare(request)).kind).toBe("READY");
    const duplicate = await value.prepare({ ...request, runId: "run-2" });
    expect(duplicate.kind).toBe("DUPLICATE");
    expect(duplicate.run.runId).toBe("run-1");
  });

  it("skips inactive automations before browser work", async () => {
    const result = await coordinator({ automation: automation({ status: "DISABLED" }) }).value.prepare(request);
    expect(result.kind).toBe("SKIPPED");
    expect(result.run.status).toBe("SKIPPED");
  });

  it("durably checkpoints scheduled inputs when an authorized browser profile is missing", async () => {
    const { value, checkpoints } = coordinator({
      profilePresent: false,
      workflow: inputWorkflow(),
      automation: automation({ scheduledNonSecretInputs: { capture_input_3: "ops-team" } }),
    });
    const result = await value.prepare(request);
    expect(result.kind).toBe("BLOCKED");
    expect(result.run.status).toBe("WAITING_FOR_HUMAN");
    expect(checkpoints.value?.lastFailure?.code).toBe("TARGET_AUTH_REQUIRED");
    expect(checkpoints.value?.variables).toEqual({ "capture.literal": "Monthly report", capture_input_3: "ops-team" });
  });

  it("accepts provider readiness checks without introducing provider dependencies", async () => {
    const check: RunPreflightCheck = { async check() { return { ready: false, disposition: "WAITING_FOR_HUMAN", failure: { code: "NOT_CONFIGURED", message: "reasoning provider not configured", retryable: false, evidenceRefs: [] } }; } };
    const { value, checkpoints } = coordinator({ preflightChecks: [check] });
    expect((await value.prepare(request)).kind).toBe("BLOCKED");
    expect(checkpoints.value?.lastFailure?.code).toBe("NOT_CONFIGURED");
  });

  it("skips a distinct occurrence when another run owns the automation lease", async () => {
    const result = await coordinator({ lockAvailable: false }).value.prepare(request);
    expect(result.kind).toBe("SKIPPED");
    if (result.kind !== "SKIPPED") throw new Error("expected SKIPPED");
    expect(result.reason).toBe("CONCURRENT_RUN");
  });
});
