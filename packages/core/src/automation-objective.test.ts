import { describe, expect, it, vi } from "vitest";
import type { AutomationRecord, WorkflowGraph } from "@automation/contracts";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  canUpdateAutomationObjective,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import type { OwnershipScope } from "./index.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";
import { AUTOMATION_DRAFT_LIMITS } from "./product-lifecycle.js";

const owner: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const attacker: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

function graph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    workflowId: "auto-1",
    automationId: "auto-1",
    version: 1,
    entryNodeId: "end",
    objective: "Old objective",
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

function record(status: AutomationRecord["status"] = "DRAFT", published = false): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Daily report",
    websiteUrl: "https://example.test/app",
    prompt: "Old objective",
    status,
    browserProfileRef: "profile-server-only",
    ...(published ? {
      publishedWorkflowVersion: 1,
      schedule: { kind: "DAILY" as const, expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
      scheduledNonSecretInputs: { capture_input_1: "old reusable value" },
    } : {}),
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function lifecycle(automation: AutomationRecord): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => automation),
    persistCapture: vi.fn(async (request) => request.trace),
    compile: vi.fn(async () => graph()),
    runFreshTest: vi.fn(async () => { throw new Error("unused"); }),
    publish: vi.fn(async () => automation),
    history: vi.fn(async () => []),
  };
}

async function setup(automation: AutomationRecord) {
  const automations = new InMemoryAutomationRepository();
  const runs = new InMemoryRunRepository();
  const captureState = new InMemoryCaptureSessionStore();
  await automations.put(automation);
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  const service = new AutomationControlPlaneService({
    automations,
    runs,
    lifecycle: lifecycle(automation),
    captureSessions,
    captureState,
    capabilities: {
      auth: "CONFIGURED",
      capture: "CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "CONFIGURED",
      notifications: "CONFIGURED",
    },
    now: () => new Date("2026-08-25T01:00:00.000Z"),
  });
  return { automations, service };
}

describe("automation objective revision", () => {
  it("allows only non-executing authoring states", () => {
    for (const status of ["DRAFT", "COMPILING", "READY_TO_TEST", "READY_TO_PUBLISH", "DISABLED"] as const) {
      expect(canUpdateAutomationObjective(status)).toBe(true);
    }
    for (const status of ["CAPTURING", "TESTING", "ACTIVE", "RUNNING", "PAUSED", "NEEDS_AUTH", "NEEDS_API_KEY", "NEEDS_ATTENTION"] as const) {
      expect(canUpdateAutomationObjective(status)).toBe(false);
    }
  });

  it("invalidates unpublished compile/test readiness so the changed goal must be captured again", async () => {
    const { automations, service } = await setup(record("READY_TO_PUBLISH"));

    const result = await service.updateAutomationObjective(owner, "auto-1", { objective: "  Post the corrected report  " });

    expect(result).toMatchObject({ objective: "Post the corrected report", status: "DRAFT" });
    expect(await automations.get(owner, "auto-1")).toMatchObject({
      prompt: "Post the corrected report",
      status: "DRAFT",
      browserProfileRef: "profile-server-only",
    });
  });

  it("keeps a previously published revision disabled, preserves immutable publication context, and clears old scheduled inputs", async () => {
    const { automations, service } = await setup(record("DISABLED", true));

    const result = await service.updateAutomationObjective(owner, "auto-1", { objective: "Post the revised report" });

    expect(result).toMatchObject({ objective: "Post the revised report", status: "DISABLED", publishedWorkflowVersion: 1 });
    const stored = await automations.get(owner, "auto-1");
    expect(stored).toMatchObject({
      prompt: "Post the revised report",
      status: "DISABLED",
      publishedWorkflowVersion: 1,
      schedule: { kind: "DAILY", expression: "cron(0 9 * * ? *)", timezone: "Asia/Kolkata" },
      browserProfileRef: "profile-server-only",
    });
    expect(stored?.scheduledNonSecretInputs).toBeUndefined();
  });

  it("rejects objective changes while production execution can still be admitted", async () => {
    const { automations, service } = await setup(record("ACTIVE", true));
    const put = vi.spyOn(automations, "put");

    await expect(service.updateAutomationObjective(owner, "auto-1", { objective: "Different goal" })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(put).not.toHaveBeenCalled();
    expect((await automations.get(owner, "auto-1"))?.prompt).toBe("Old objective");
  });

  it("is idempotent for the same normalized objective", async () => {
    const { automations, service } = await setup(record("READY_TO_TEST"));
    const put = vi.spyOn(automations, "put");

    const result = await service.updateAutomationObjective(owner, "auto-1", { objective: "  Old objective  " });

    expect(result.status).toBe("READY_TO_TEST");
    expect(result.updatedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(put).not.toHaveBeenCalled();
  });

  it("enforces the same objective bound as draft creation", async () => {
    const accepted = await setup(record("DRAFT"));
    await expect(accepted.service.updateAutomationObjective(owner, "auto-1", { objective: "x".repeat(AUTOMATION_DRAFT_LIMITS.objective) })).resolves.toMatchObject({ status: "DRAFT" });

    const rejected = await setup(record("DRAFT"));
    await expect(rejected.service.updateAutomationObjective(owner, "auto-1", { objective: "x".repeat(AUTOMATION_DRAFT_LIMITS.objective + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uses authenticated ownership at the HTTP boundary and ignores forged lifecycle fields", async () => {
    const { automations, service } = await setup(record("READY_TO_TEST"));
    const handler = new AutomationControlPlaneHttpHandler(service);

    const response = await handler.handle({
      method: "POST",
      path: "/v1/automations/auto-1/objective",
      body: {
        tenantId: attacker.tenantId,
        userId: attacker.userId,
        status: "ACTIVE",
        objective: "Trusted owner revision",
      },
    }, { scope: owner });

    expect(response.status).toBe(200);
    expect(await automations.get(attacker, "auto-1")).toBeNull();
    expect(await automations.get(owner, "auto-1")).toMatchObject({ prompt: "Trusted owner revision", status: "DRAFT" });
    expect(JSON.stringify(response.body)).not.toContain("profile-server-only");
  });

  it("does not disclose authoring capability state across tenants", async () => {
    const { service } = await setup(record("DRAFT"));

    await expect(service.updateAutomationObjective(attacker, "auto-1", { objective: "attacker goal" })).rejects.toBeInstanceOf(ControlPlaneError);
    await expect(service.updateAutomationObjective(attacker, "auto-1", { objective: "attacker goal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
