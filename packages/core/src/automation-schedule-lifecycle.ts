import type { AutomationRecord, AutomationSchedule } from "@automation/contracts";
import type {
  AutomationRepository,
  OwnershipScope,
  ScheduleRegistration,
  SchedulerPort,
} from "./index.js";

export interface UpdateAutomationScheduleRequest {
  scope: OwnershipScope;
  automationId: string;
  schedule: AutomationSchedule;
}

export interface AutomationScheduleStateRequest {
  scope: OwnershipScope;
  automationId: string;
}

export interface AutomationScheduleLifecycleDependencies {
  automations: AutomationRepository;
  scheduler: SchedulerPort;
  now?: () => Date;
}

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function assertSchedule(schedule: AutomationSchedule): void {
  nonEmpty(schedule.expression, "schedule expression");
  nonEmpty(schedule.timezone, "schedule timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }).format(new Date(0));
  } catch {
    throw new Error("schedule timezone must be a valid IANA timezone");
  }
}

function scheduleId(automationId: string): string {
  return `automation:${automationId}`;
}

function registration(
  automation: AutomationRecord,
  schedule: AutomationSchedule,
  enabled: boolean,
): ScheduleRegistration {
  return {
    scheduleId: scheduleId(automation.automationId),
    automationId: automation.automationId,
    schedule: structuredClone(schedule),
    enabled,
  };
}

export class AutomationScheduleLifecycleService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: AutomationScheduleLifecycleDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async updateSchedule(request: UpdateAutomationScheduleRequest): Promise<AutomationRecord> {
    assertSchedule(request.schedule);
    const automation = await this.requirePublishedAutomation(request.scope, request.automationId);
    if (automation.status !== "ACTIVE" && automation.status !== "PAUSED") {
      throw new Error("only ACTIVE or PAUSED automations may update recurrence");
    }

    const enabled = automation.status === "ACTIVE";
    await this.dependencies.scheduler.upsert(
      request.scope,
      registration(automation, request.schedule, enabled),
    );

    const updated: AutomationRecord = {
      ...automation,
      schedule: structuredClone(request.schedule),
      updatedAt: this.now().toISOString(),
    };
    await this.dependencies.automations.put(updated);
    return structuredClone(updated);
  }

  async pause(request: AutomationScheduleStateRequest): Promise<AutomationRecord> {
    const automation = await this.requirePublishedAutomation(request.scope, request.automationId);
    if (automation.status !== "ACTIVE") {
      throw new Error("only an ACTIVE automation may be paused");
    }

    const paused: AutomationRecord = {
      ...automation,
      status: "PAUSED",
      updatedAt: this.now().toISOString(),
    };

    // Persist the execution-authoritative state first. If Scheduler mutation is
    // uncertain, a stale delivery still reaches preflight as PAUSED and cannot
    // start browser/model work.
    await this.dependencies.automations.put(paused);
    await this.dependencies.scheduler.upsert(
      request.scope,
      registration(paused, paused.schedule!, false),
    );
    return structuredClone(paused);
  }

  async resume(request: AutomationScheduleStateRequest): Promise<AutomationRecord> {
    const automation = await this.requirePublishedAutomation(request.scope, request.automationId);
    if (automation.status !== "PAUSED") {
      throw new Error("only a PAUSED automation may be resumed");
    }

    // Enable the external trigger before advertising ACTIVE. A trigger racing
    // this boundary can at worst be skipped while the durable record is PAUSED.
    await this.dependencies.scheduler.upsert(
      request.scope,
      registration(automation, automation.schedule!, true),
    );

    const resumed: AutomationRecord = {
      ...automation,
      status: "ACTIVE",
      updatedAt: this.now().toISOString(),
    };
    await this.dependencies.automations.put(resumed);
    return structuredClone(resumed);
  }

  async disable(request: AutomationScheduleStateRequest): Promise<AutomationRecord> {
    const automation = await this.requirePublishedAutomation(request.scope, request.automationId);
    if (automation.status === "DISABLED") return structuredClone(automation);
    if (automation.status !== "ACTIVE" && automation.status !== "PAUSED") {
      throw new Error("only ACTIVE or PAUSED automations may be disabled");
    }

    const disabled: AutomationRecord = {
      ...automation,
      status: "DISABLED",
      updatedAt: this.now().toISOString(),
    };

    // As with pause, durable state is the execution authority. Keep the
    // Scheduler resource disabled instead of deleting workflow/history state.
    await this.dependencies.automations.put(disabled);
    await this.dependencies.scheduler.upsert(
      request.scope,
      registration(disabled, disabled.schedule!, false),
    );
    return structuredClone(disabled);
  }

  private async requirePublishedAutomation(
    scope: OwnershipScope,
    automationId: string,
  ): Promise<AutomationRecord> {
    const id = nonEmpty(automationId, "automationId");
    const automation = await this.dependencies.automations.get(scope, id);
    if (!automation) throw new Error(`automation '${id}' does not exist in ownership scope`);
    if (automation.publishedWorkflowVersion === undefined || !automation.schedule) {
      throw new Error("automation must be published before schedule lifecycle changes");
    }
    assertSchedule(automation.schedule);
    return automation;
  }
}
