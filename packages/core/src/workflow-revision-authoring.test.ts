import { describe, expect, it } from "vitest";
import type { AutomationRecord, CaptureTrace } from "@automation/contracts";
import {
  AutomationProductLifecycleService,
  InMemoryCaptureTraceRepository,
  canAuthorWorkflowCapture,
} from "./product-lifecycle.js";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryBrowserProfileStore,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryScheduler,
  InMemoryWorkflowVersionRepository,
} from "./memory.js";
import type {
  BrowserExecutor,
  OwnershipScope,
  ReasoningProvider,
  VerificationEngine,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-revision", userId: "user-revision" };
const schedule = { kind: "DAILY" as const, expression: "cron(0 9 * * ? *)", timezone: "UTC" };

const browser: BrowserExecutor = {
  async executeDeterministic() { throw new Error("browser execution is not expected in authoring-state tests"); },
  async executeSemantic() { throw new Error("browser execution is not expected in authoring-state tests"); },
};
const verifier: VerificationEngine = {
  async verify() { throw new Error("verification is not expected in authoring-state tests"); },
};
const reasoner: ReasoningProvider = {
  async decide() { throw new Error("reasoning is not expected in authoring-state tests"); },
};

function trace(profileRef: string): CaptureTrace {
  return {
    schemaVersion: 1,
    traceId: "trace-revision-1",
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-revision",
    websiteUrl: "https://example.test/app",
    objective: "Submit the approved form",
    browserProfileRef: profileRef,
    startedAt: "2026-08-23T00:00:00.000Z",
    finishedAt: "2026-08-23T00:00:02.000Z",
    events: [
      {
        eventId: "submit",
        sequence: 1,
        kind: "CLICK",
        purpose: "WORKFLOW",
        occurredAt: "2026-08-23T00:00:01.000Z",
        page: { url: "https://example.test/app" },
        target: { testId: "submit", role: "button", accessibleName: "Submit" },
        expectedEffect: {
          description: "Success confirmation appears",
          mode: "TEXT",
          expected: "Saved",
          timeoutMs: 5_000,
        },
        artifactRefs: [],
      },
    ],
  };
}

async function harness(status: AutomationRecord["status"]) {
  const automations = new InMemoryAutomationRepository();
  const captures = new InMemoryCaptureTraceRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const profiles = new InMemoryBrowserProfileStore();
  const scheduler = new InMemoryScheduler();
  const locks = new InMemoryAutomationLockManager(() => new Date("2026-08-23T00:10:00.000Z"));
  const profileRef = await profiles.create(scope, "automation-revision");
  const record: AutomationRecord = {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-revision",
    name: "Revision example",
    websiteUrl: "https://example.test/app",
    prompt: "Submit the approved form",
    status,
    browserProfileRef: profileRef,
    ...(status === "DISABLED" || status === "ACTIVE"
      ? {
          publishedWorkflowVersion: 4,
          schedule,
          scheduledNonSecretInputs: { capture_input_2: "old-value" },
        }
      : {}),
    notifyOnSuccess: true,
    notifyOnFailure: true,
    createdAt: "2026-08-22T23:00:00.000Z",
    updatedAt: "2026-08-22T23:00:00.000Z",
  };
  await automations.put(record);
  const service = new AutomationProductLifecycleService({
    automations,
    captures,
    workflows,
    runs,
    checkpoints,
    profiles,
    scheduler,
    locks,
    browser,
    verifier,
    reasoner,
    now: () => new Date("2026-08-23T00:10:00.000Z"),
  });
  return { automations, service, profileRef };
}

describe("workflow revision authoring", () => {
  it("allows capture only in states where production execution cannot start", () => {
    for (const status of ["DRAFT", "COMPILING", "READY_TO_TEST", "READY_TO_PUBLISH", "DISABLED"] as const) {
      expect(canAuthorWorkflowCapture(status), status).toBe(true);
    }
    for (const status of ["CAPTURING", "TESTING", "ACTIVE", "RUNNING", "PAUSED", "NEEDS_AUTH", "NEEDS_API_KEY", "NEEDS_ATTENTION"] as const) {
      expect(canAuthorWorkflowCapture(status), status).toBe(false);
    }
  });

  it("lets an explicitly disabled published automation begin a new immutable revision without losing published history", async () => {
    const { automations, service, profileRef } = await harness("DISABLED");

    await service.persistCapture({ scope, trace: trace(profileRef) });

    const revised = await automations.get(scope, "automation-revision");
    expect(revised).toMatchObject({
      status: "COMPILING",
      publishedWorkflowVersion: 4,
      schedule,
      browserProfileRef: profileRef,
      scheduledNonSecretInputs: { capture_input_2: "old-value" },
    });
  });

  it("still rejects capture while the published automation is active", async () => {
    const { service, profileRef } = await harness("ACTIVE");

    await expect(service.persistCapture({ scope, trace: trace(profileRef) })).rejects.toThrow(
      "non-executing workflow-authoring state",
    );
  });

  it("allows a successfully tested but not yet published workflow to return to capture for correction", async () => {
    const { service, profileRef } = await harness("READY_TO_PUBLISH");

    await expect(service.persistCapture({ scope, trace: trace(profileRef) })).resolves.toMatchObject({
      traceId: "trace-revision-1",
    });
  });
});
