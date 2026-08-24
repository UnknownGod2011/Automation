import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, RunRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { AutomationControlPlaneService, type AutomationLifecyclePort, type CaptureSessionStarter } from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import type { OwnershipScope } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-history", userId: "user-history" };
const INTERNAL_NODE_ID = "internal-workflow-node-42";

function automation(): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-history",
    name: "History redaction",
    websiteUrl: "https://example.test/app",
    prompt: "Verify history redaction",
    status: "PAUSED",
    browserProfileRef: "server-profile-ref",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function graph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "wf-history",
    automationId: "auto-history",
    version: 1,
    entryNodeId: "end",
    objective: "Verify history redaction",
    nodes: {
      end: {
        id: "end",
        kind: "END",
        objective: "Done",
        deterministicStrategies: [],
        inputBindings: {},
        outputBindings: {},
        allowedSideEffects: [],
        retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0, jitter: false, retryableFailureCodes: [] },
        timeoutMs: 1_000,
        escalation: "FAIL",
      },
    },
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

function lifecycle(run: RunRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => automation()),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => graph()),
    runFreshTest: vi.fn(async () => ({ kind: "DUPLICATE" as const, run, checkpoint: null })),
    publish: vi.fn(async () => automation()),
    history: vi.fn(async () => [run]),
  };
}

async function handlerWithPausedRun() {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  const record = automation();
  const run: RunRecord = {
    tenantId: scope.tenantId,
    userId: scope.userId,
    runId: "run-history-1",
    automationId: record.automationId,
    workflowVersion: 1,
    occurrenceKey: "auto-history:2026-08-25T00:05:00.000Z",
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-25T00:05:00.000Z",
    currentNodeId: INTERNAL_NODE_ID,
    failure: { code: "TARGET_AUTH_REQUIRED", message: "server-only failure detail", retryable: false },
  };
  await automations.put(record);
  await runs.createIfAbsent(run);
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: lifecycle(run),
    captureSessions,
    captureState,
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "NOT_CONFIGURED",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "NOT_CONFIGURED",
      notifications: "NOT_CONFIGURED",
    },
  });
  return new AutomationControlPlaneHttpHandler(service);
}

describe("authenticated run-history transport redaction", () => {
  it("keeps workflow node identity out of dashboard, automation detail, and run-history responses", async () => {
    const handler = await handlerWithPausedRun();

    const dashboard = await handler.handle({ method: "GET", path: "/v1/automations" }, { scope });
    const automationDetail = await handler.handle({ method: "GET", path: "/v1/automations/auto-history" }, { scope });
    const history = await handler.handle({ method: "GET", path: "/v1/automations/auto-history/runs" }, { scope });

    expect(dashboard.status).toBe(200);
    expect(automationDetail.status).toBe(200);
    expect(history.status).toBe(200);
    for (const response of [dashboard, automationDetail, history]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(INTERNAL_NODE_ID);
      expect(serialized).not.toContain("currentNodeId");
      expect(serialized).toContain("TARGET_AUTH_REQUIRED");
    }
  });

  it("also redacts nested last-run node identity from summary-returning mutations", async () => {
    const handler = await handlerWithPausedRun();

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-history/notifications",
        body: { notifyOnSuccess: true, notifyOnFailure: true },
      },
      { scope },
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(INTERNAL_NODE_ID);
    expect(JSON.stringify(response.body)).not.toContain("currentNodeId");
  });
});
