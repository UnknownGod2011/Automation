import { describe, expect, it } from "vitest";
import type { AutomationRecord, AutomationSchedule } from "@automation/contracts";
import {
  InMemoryAutomationRepository,
  InMemoryScheduler,
} from "./memory.js";
import { AutomationScheduleLifecycleService } from "./automation-schedule-lifecycle.js";
import type { OwnershipScope, SchedulerPort } from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const otherScope: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };
const schedule: AutomationSchedule = {
  kind: "DAILY",
  expression: "cron(0 9 * * ? *)",
  timezone: "Asia/Kolkata",
};

function activeRecord(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "auto-1",
    name: "Daily workflow",
    websiteUrl: "https://example.com/",
    prompt: "Do the permitted task",
    status: "ACTIVE",
    publishedWorkflowVersion: 3,
    browserProfileRef: "profile-1",
    schedule,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

async function seeded() {
  const automations = new InMemoryAutomationRepository();
  const scheduler = new InMemoryScheduler();
  await automations.put(activeRecord());
  await scheduler.upsert(scope, {
    scheduleId: "automation:auto-1",
    automationId: "auto-1",
    schedule,
    enabled: true,
  });
  const service = new AutomationScheduleLifecycleService({
    automations,
    scheduler,
    now: () => new Date("2026-08-21T01:00:00.000Z"),
  });
  return { automations, scheduler, service };
}

describe("AutomationScheduleLifecycleService", () => {
  it("updates recurrence while preserving ACTIVE delivery", async () => {
    const { automations, scheduler, service } = await seeded();
    const next: AutomationSchedule = {
      kind: "WEEKLY",
      expression: "cron(30 8 ? * MON *)",
      timezone: "Europe/Zurich",
    };

    const updated = await service.updateSchedule({ scope, automationId: "auto-1", schedule: next });

    expect(updated.status).toBe("ACTIVE");
    expect(updated.schedule).toEqual(next);
    expect((await automations.get(scope, "auto-1"))?.publishedWorkflowVersion).toBe(3);
    expect(await scheduler.get(scope, "automation:auto-1")).toEqual({
      scheduleId: "automation:auto-1",
      automationId: "auto-1",
      schedule: next,
      enabled: true,
    });
  });

  it("updates recurrence without re-enabling a paused automation", async () => {
    const { automations, scheduler, service } = await seeded();
    await automations.put(activeRecord({ status: "PAUSED" }));
    const next: AutomationSchedule = {
      kind: "HOURLY",
      expression: "rate(1 hour)",
      timezone: "UTC",
    };

    await service.updateSchedule({ scope, automationId: "auto-1", schedule: next });

    expect((await automations.get(scope, "auto-1"))?.status).toBe("PAUSED");
    expect((await scheduler.get(scope, "automation:auto-1"))?.enabled).toBe(false);
  });

  it("persists PAUSED before disabling the scheduler so stale delivery fails closed", async () => {
    const automations = new InMemoryAutomationRepository();
    await automations.put(activeRecord());
    const scheduler: SchedulerPort = {
      async upsert() {
        throw new Error("scheduler unavailable");
      },
      async delete() {},
      async get() { return null; },
    };
    const service = new AutomationScheduleLifecycleService({ automations, scheduler });

    await expect(service.pause({ scope, automationId: "auto-1" })).rejects.toThrow("scheduler unavailable");
    expect((await automations.get(scope, "auto-1"))?.status).toBe("PAUSED");
  });

  it("keeps PAUSED durable state when resume cannot enable the external trigger", async () => {
    const automations = new InMemoryAutomationRepository();
    await automations.put(activeRecord({ status: "PAUSED" }));
    const scheduler: SchedulerPort = {
      async upsert() {
        throw new Error("scheduler unavailable");
      },
      async delete() {},
      async get() { return null; },
    };
    const service = new AutomationScheduleLifecycleService({ automations, scheduler });

    await expect(service.resume({ scope, automationId: "auto-1" })).rejects.toThrow("scheduler unavailable");
    expect((await automations.get(scope, "auto-1"))?.status).toBe("PAUSED");
  });

  it("disables future schedule delivery without deleting published state", async () => {
    const { automations, scheduler, service } = await seeded();

    const disabled = await service.disable({ scope, automationId: "auto-1" });

    expect(disabled.status).toBe("DISABLED");
    expect(disabled.publishedWorkflowVersion).toBe(3);
    expect(disabled.schedule).toEqual(schedule);
    expect((await scheduler.get(scope, "automation:auto-1"))?.enabled).toBe(false);
    await expect(service.disable({ scope, automationId: "auto-1" })).resolves.toEqual(disabled);
    expect((await automations.get(scope, "auto-1"))?.browserProfileRef).toBe("profile-1");
  });

  it("rejects invalid lifecycle transitions and cross-tenant access", async () => {
    const { automations, service } = await seeded();
    await expect(service.pause({ scope: otherScope, automationId: "auto-1" })).rejects.toThrow(
      "does not exist in ownership scope",
    );

    await automations.put(activeRecord({ status: "READY_TO_PUBLISH" }));
    await expect(service.pause({ scope, automationId: "auto-1" })).rejects.toThrow(
      "only an ACTIVE automation may be paused",
    );
    await expect(
      service.updateSchedule({
        scope,
        automationId: "auto-1",
        schedule: { ...schedule, timezone: "Not/A_Zone" },
      }),
    ).rejects.toThrow("valid IANA timezone");
  });
});
