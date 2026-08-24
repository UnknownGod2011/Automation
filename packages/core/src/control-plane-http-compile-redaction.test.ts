import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import type { OwnershipScope } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-compile", userId: "user-compile" };
const browserProfileRef = "server-profile-ref";

function automation(): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-compile",
    name: "Compile safely",
    websiteUrl: "https://example.com/app",
    prompt: "Submit the verified workflow",
    status: "COMPILING",
    browserProfileRef,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:00.000Z",
  };
}

function compiledGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "internal-workflow-id",
    automationId: "automation-compile",
    version: 7,
    entryNodeId: "internal-end-node",
    objective: "Submit the verified workflow",
    nodes: {
      "internal-end-node": {
        id: "internal-end-node",
        kind: "END",
        objective: "Internal terminal step",
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
    initialVariables: { "capture_public_literal": "internal-compiled-value" },
    createdAt: "2026-08-24T12:01:00.000Z",
  };
}

function lifecycle(record: AutomationRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => record),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => compiledGraph()),
    runFreshTest: vi.fn(async () => { throw new Error("not used"); }),
    publish: vi.fn(async () => record),
    history: vi.fn(async () => []),
  };
}

describe("AutomationControlPlaneHttpHandler compile response", () => {
  it("returns only bounded compile acknowledgement while keeping the executable workflow server-side", async () => {
    const record = automation();
    const automations = new InMemoryAutomationRepository();
    const runs = new InMemoryRunRepository();
    const captureState = new InMemoryCaptureSessionStore();
    await automations.put(record);
    await captureState.putStarted({
      tenantId: scope.tenantId,
      userId: scope.userId,
      automationId: record.automationId,
      captureSessionId: "capture-session-server-id",
      browserSessionId: "browser-session-server-id",
      browserProfileRef,
      startedAt: "2026-08-24T12:00:00.000Z",
      expiresAt: "2026-08-24T13:00:00.000Z",
      status: "STARTED",
    });
    await captureState.complete(scope, "capture-session-server-id", "trace-server-id", "2026-08-24T12:01:00.000Z");

    const captureSessions: CaptureSessionStarter = {
      start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "not used" })),
    };
    const service = new AutomationControlPlaneService({
      automations,
      runs,
      lifecycle: lifecycle(record),
      captureSessions,
      captureState,
      capabilities: {
        auth: "LOCAL_MOCK",
        capture: "LOCAL_MOCK",
        cloudExecution: "LOCAL_MOCK",
        scheduling: "LOCAL_MOCK",
        notifications: "NOT_CONFIGURED",
      },
    });
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle(
      { method: "POST", path: `/v1/automations/${record.automationId}/compile`, body: {} },
      { scope },
    );

    expect(response).toEqual({
      status: 200,
      body: { kind: "COMPILED", workflowVersion: 7 },
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("internal-workflow-id");
    expect(serialized).not.toContain("internal-end-node");
    expect(serialized).not.toContain("internal-compiled-value");
    expect(serialized).not.toContain("trace-server-id");
    expect(serialized).not.toContain(browserProfileRef);
  });
});