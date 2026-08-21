import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryAutomationRepository, InMemoryWorkflowVersionRepository } from "./memory.js";
import {
  WorkflowInspectionControlPlaneHttpHandler,
  WorkflowInspectionService,
} from "./workflow-inspection.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type { OwnershipScope, WorkflowVersionRepository } from "./index.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function automation(): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Update account note",
    websiteUrl: "https://example.test/app",
    prompt: "Update the account note",
    status: "READY_TO_TEST",
    browserProfileRef: "profile-secret-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:05:00.000Z",
  };
}

function graph(version: number): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "internal-workflow-secret-id",
    automationId: "auto-1",
    version,
    entryNodeId: "secret-node-id",
    objective: "Update the account note",
    nodes: {
      "secret-node-id": {
        id: "secret-node-id",
        kind: "TYPE",
        objective: "Enter the account note",
        deterministicStrategies: [
          { kind: "CSS", value: "#private-selector", confidence: 0.9 },
          { kind: "TEXT", value: "private visible target", confidence: 0.8 },
        ],
        inputBindings: {
          value: "capture_input_7",
          privateHint: "secret.runtime.variable",
          preseeded: "capture_input_8",
        },
        outputBindings: { privateOutput: "secret.output.variable" },
        allowedSideEffects: ["TYPE"],
        verification: {
          description: "private verification description",
          mode: "TEXT",
          expected: "private expected value",
          timeoutMs: 5_000,
        },
        retryPolicy: {
          maxAttempts: 3,
          initialBackoffMs: 500,
          maxBackoffMs: 4_000,
          jitter: true,
          retryableFailureCodes: ["ELEMENT_NOT_FOUND", "EFFECT_NOT_VERIFIED"],
        },
        timeoutMs: 20_000,
        next: ["end-secret-id"],
        escalation: "SEMANTIC_RECOVERY",
      },
      "end-secret-id": {
        id: "end-secret-id",
        kind: "END",
        objective: "Workflow complete",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: {
          maxAttempts: 1,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: false,
          retryableFailureCodes: [],
        },
        timeoutMs: 1_000,
        escalation: "FAIL",
      },
    },
    initialVariables: {
      "capture.literal": "private literal value",
      capture_input_8: "private preseeded value",
    },
    createdAt: `2026-08-21T12:0${version}:00.000Z`,
  };
}

async function setup() {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  await automations.put(automation());
  await workflows.putImmutable(owner, graph(1));
  await workflows.putImmutable(owner, graph(2));
  return { automations, workflows, service: new WorkflowInspectionService(automations, workflows) };
}

describe("WorkflowInspectionService", () => {
  it("returns the latest semantic plan and only exposes unresolved capture-generated input placeholders", async () => {
    const { service } = await setup();

    const view = await service.latest(owner, "auto-1");

    expect(view).not.toBeNull();
    expect(view?.version).toBe(2);
    expect(view?.totalNodeCount).toBe(2);
    expect(view?.nodes[0]).toEqual({
      step: 1,
      kind: "TYPE",
      objective: "Enter the account note",
      allowedSideEffects: ["TYPE"],
      verification: { mode: "TEXT", timeoutMs: 5_000 },
      maxAttempts: 3,
      timeoutMs: 20_000,
      escalation: "SEMANTIC_RECOVERY",
      nextSteps: [2],
      hasBoundInputs: true,
    });
    expect(view?.runtimeInputs).toEqual([
      { key: "capture_input_7", step: 1, treatAsSensitive: true },
    ]);

    const serialized = JSON.stringify(view);
    expect(serialized).toContain("capture_input_7");
    expect(serialized).not.toContain("capture_input_8");
    for (const forbidden of [
      "internal-workflow-secret-id",
      "secret-node-id",
      "end-secret-id",
      "#private-selector",
      "private visible target",
      "secret.runtime.variable",
      "secret.output.variable",
      "private verification description",
      "private expected value",
      "private literal value",
      "private preseeded value",
      "ELEMENT_NOT_FOUND",
      "profile-secret-ref",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not expose arbitrary runtime binding names that merely resemble application data", async () => {
    const automations = new InMemoryAutomationRepository();
    const workflows = new InMemoryWorkflowVersionRepository();
    await automations.put(automation());
    const privateGraph = graph(1);
    await workflows.putImmutable(owner, {
      ...privateGraph,
      nodes: {
        ...privateGraph.nodes,
        "secret-node-id": {
          ...privateGraph.nodes["secret-node-id"]!,
          inputBindings: { value: "customer.email", secret: "api_token" },
        },
      },
    });

    const view = await new WorkflowInspectionService(automations, workflows).latest(owner, "auto-1");
    expect(view?.runtimeInputs).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("customer.email");
    expect(JSON.stringify(view)).not.toContain("api_token");
  });

  it("returns no workflow before compilation and keeps tenant scope authoritative", async () => {
    const automations = new InMemoryAutomationRepository();
    const workflows = new InMemoryWorkflowVersionRepository();
    await automations.put(automation());
    const service = new WorkflowInspectionService(automations, workflows);

    await expect(service.latest(owner, "auto-1")).resolves.toBeNull();
    await expect(service.latest(attacker, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });

  it("fails closed when workflow storage returns a graph for another automation", async () => {
    const automations = new InMemoryAutomationRepository();
    await automations.put(automation());
    const corrupted: WorkflowVersionRepository = {
      get: vi.fn(async () => null),
      putImmutable: vi.fn(async () => undefined),
      list: vi.fn(async () => [{ ...graph(2), automationId: "other-automation" }]),
    };
    const service = new WorkflowInspectionService(automations, corrupted);

    await expect(service.latest(owner, "auto-1")).rejects.toEqual(
      expect.objectContaining({ code: "CONFLICT" }),
    );
  });

  it("exposes the inspection through a read-only authenticated route and delegates unrelated routes", async () => {
    const { service } = await setup();
    const base: ControlPlaneHttpHandlerPort = {
      handle: vi.fn(async () => ({ status: 418, body: { delegated: true } })),
    };
    const handler = new WorkflowInspectionControlPlaneHttpHandler(base, service);

    const response = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1/workflow" },
      { scope: owner },
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      workflow: expect.objectContaining({
        version: 2,
        runtimeInputs: [{ key: "capture_input_7", step: 1, treatAsSensitive: true }],
      }),
    }));

    const methodRejected = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/workflow" },
      { scope: owner },
    );
    expect(methodRejected.status).toBe(404);

    const delegated = await handler.handle(
      { method: "GET", path: "/v1/automations/auto-1" },
      { scope: owner },
    );
    expect(delegated.status).toBe(418);
  });
});