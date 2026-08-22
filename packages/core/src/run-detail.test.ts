import { describe, expect, it } from "vitest";
import type { RunCheckpoint, RunRecord, WorkflowGraph, WorkflowNode } from "@automation/contracts";
import {
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
} from "./memory.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import { RunDetailControlPlaneHttpHandler, RunDetailService } from "./run-detail.js";
import type { OwnershipScope, WorkflowVersionRepository } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

const retryPolicy = {
  maxAttempts: 2,
  initialBackoffMs: 100,
  maxBackoffMs: 500,
  jitter: false,
  retryableFailureCodes: ["TRANSIENT_NETWORK" as const],
};

interface TestNodeParams {
  id: string;
  kind: WorkflowNode["kind"];
  objective: string;
  next?: readonly string[];
  inputBindings?: Readonly<Record<string, string>>;
  allowedSideEffects?: readonly string[];
  verification?: WorkflowNode["verification"];
}

function node(params: TestNodeParams): WorkflowNode {
  return {
    id: params.id,
    kind: params.kind,
    objective: params.objective,
    deterministicStrategies: [{ kind: "CSS", value: "#private-selector" }],
    inputBindings: params.inputBindings ?? {},
    outputBindings: {},
    allowedSideEffects: params.allowedSideEffects ?? [],
    ...(params.verification ? { verification: params.verification } : {}),
    retryPolicy,
    timeoutMs: 5_000,
    ...(params.next ? { next: params.next } : {}),
    escalation: "FAIL",
  };
}

function workflow(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "workflow-private-id",
    automationId: "auto-1",
    version: 3,
    entryNodeId: "open",
    objective: "Submit the demonstrated form",
    nodes: {
      open: node({ id: "open", kind: "NAVIGATE", objective: "Open the form", next: ["fill"] }),
      fill: node({
        id: "fill",
        kind: "TYPE",
        objective: "Fill the approved value",
        inputBindings: { text: "private_binding_name" },
        allowedSideEffects: ["type"],
        verification: { mode: "CUSTOM", description: "private verification", expected: "private expected value", timeoutMs: 1_000 },
        next: ["submit"],
      }),
      submit: node({
        id: "submit",
        kind: "CLICK",
        objective: "Submit the form",
        allowedSideEffects: ["click"],
        verification: { mode: "DOM", description: "private confirmation selector", expected: "#success-secret", timeoutMs: 1_000 },
        next: ["end"],
      }),
      end: node({ id: "end", kind: "END", objective: "Finish" }),
    },
    initialVariables: { private_binding_name: "private initial value" },
    createdAt: "2026-08-21T07:59:00.000Z",
  };
}

function pausedRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    occurrenceKey: "auto-1:2026-08-21T08:00:00.000Z",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-21T08:00:00.000Z",
    startedAt: "2026-08-21T08:00:01.000Z",
    currentNodeId: "submit",
    failure: {
      code: "EFFECT_NOT_VERIFIED",
      message: "private provider/browser detail must not leave the service",
      retryable: false,
      nodeId: "submit",
      evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    },
    ...overrides,
  };
}

function pausedCheckpoint(overrides: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 3,
    currentNodeId: "submit",
    completedNodeIds: ["open", "fill"],
    attempt: 2,
    stateFingerprint: "private-page-fingerprint",
    fingerprintRepeatCount: 2,
    variables: { password: "must-never-be-returned", customer: "private-runtime-value" },
    evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    lastFailure: {
      code: "EFFECT_NOT_VERIFIED",
      message: "private checkpoint detail",
      retryable: false,
      nodeId: "submit",
      evidenceRefs: ["evidence/run-1/submit/attempt-2"],
    },
    updatedAt: "2026-08-21T08:00:10.000Z",
    ...overrides,
  };
}

async function setup() {
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  await runs.createIfAbsent(pausedRun());
  await checkpoints.put(owner, pausedCheckpoint());
  await workflows.putImmutable(owner, workflow());
  return { runs, checkpoints, workflows, service: new RunDetailService(runs, checkpoints, workflows) };
}

describe("RunDetailService", () => {
  it("returns bounded semantic progress without exposing executable workflow metadata", async () => {
    const { service } = await setup();

    const detail = await service.get(owner, "auto-1", "run-1");

    expect(detail).toMatchObject({
      runId: "run-1",
      automationId: "auto-1",
      workflowVersion: 3,
      status: "WAITING_FOR_HUMAN",
      currentNodeId: "submit",
      needsHumanAttention: true,
      failure: {
        code: "EFFECT_NOT_VERIFIED",
        retryable: false,
        nodeId: "submit",
      },
      checkpoint: {
        currentNodeId: "submit",
        completedNodeIds: ["open", "fill"],
        attempt: 2,
        fingerprintRepeatCount: 2,
        updatedAt: "2026-08-21T08:00:10.000Z",
      },
      semantic: {
        current: { step: 3, kind: "CLICK", objective: "Submit the form" },
        completed: [
          { step: 1, kind: "NAVIGATE", objective: "Open the form" },
          { step: 2, kind: "TYPE", objective: "Fill the approved value" },
        ],
        failure: { step: 3, kind: "CLICK", objective: "Submit the form" },
      },
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("must-never-be-returned");
    expect(serialized).not.toContain("private-runtime-value");
    expect(serialized).not.toContain("private-page-fingerprint");
    expect(serialized).not.toContain("private provider/browser detail");
    expect(serialized).not.toContain("private checkpoint detail");
    expect(serialized).not.toContain("#private-selector");
    expect(serialized).not.toContain("private_binding_name");
    expect(serialized).not.toContain("private expected value");
    expect(serialized).not.toContain("#success-secret");
  });

  it("keeps status/checkpoint diagnostics available when workflow inspection is unavailable", async () => {
    const { runs, checkpoints } = await setup();
    const unavailable: WorkflowVersionRepository = {
      async get() { throw new Error("storage detail must not escape"); },
      async putImmutable() { throw new Error("not used"); },
      async list() { throw new Error("not used"); },
    };
    const service = new RunDetailService(runs, checkpoints, unavailable);

    const detail = await service.get(owner, "auto-1", "run-1");

    expect(detail.status).toBe("WAITING_FOR_HUMAN");
    expect(detail.semantic).toBeUndefined();
    expect(detail.humanResumeEligible).toBe(false);
  });

  it("does not reveal a run across tenant or automation boundaries", async () => {
    const { service } = await setup();

    await expect(service.get(attacker, "auto-1", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.get(owner, "auto-other", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails closed when checkpoint durable identity disagrees with the run", async () => {
    const { runs, checkpoints, workflows } = await setup();
    await checkpoints.put(owner, pausedCheckpoint({ workflowVersion: 4 }));
    const service = new RunDetailService(runs, checkpoints, workflows);

    await expect(service.get(owner, "auto-1", "run-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects unbounded or malformed evidence references rather than reflecting corrupted state", async () => {
    const { runs, checkpoints, workflows } = await setup();
    await checkpoints.put(owner, pausedCheckpoint({ evidenceRefs: ["x".repeat(513)] }));
    const service = new RunDetailService(runs, checkpoints, workflows);

    await expect(service.get(owner, "auto-1", "run-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("RunDetailControlPlaneHttpHandler", () => {
  it("serves the authenticated run-detail route and delegates unrelated traffic", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = {
      async handle() {
        return { status: 418, body: { delegated: true } };
      },
    };
    const handler = new RunDetailControlPlaneHttpHandler(base, service);

    const detail = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs/run-1" },
      { scope: owner },
    );
    const delegated = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1" },
      { scope: owner },
    );

    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      runId: "run-1",
      needsHumanAttention: true,
      semantic: { current: { step: 3, objective: "Submit the form" } },
    });
    expect(delegated).toEqual({ status: 418, body: { delegated: true } });
  });

  it("returns not found for cross-tenant run detail without leaking whether the run exists", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = { async handle() { return { status: 404, body: {} }; } };
    const handler = new RunDetailControlPlaneHttpHandler(base, service);

    const response = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/runs/run-1" },
      { scope: attacker },
    );

    expect(response).toEqual({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "run not found" } },
    });
  });
});