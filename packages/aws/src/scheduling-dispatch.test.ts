import { describe, expect, it, vi } from "vitest";
import type { ScheduleRegistration, ScheduledDispatchEnvelope } from "@automation/core";
import {
  AwsEventBridgeSchedulerAdapter,
  AwsSqsScheduledDispatchHandler,
  AwsStepFunctionsScheduledExecutionStarter,
  type AwsSchedulerApi,
  type AwsSchedulerDefinition,
} from "./scheduling-dispatch.js";

const scope = { tenantId: "tenant-a", userId: "user-a" } as const;
const registration: ScheduleRegistration = {
  scheduleId: "automation:automation-a",
  automationId: "automation-a",
  schedule: { kind: "CRON", expression: "cron(0 9 ? * MON-FRI *)", timezone: "Asia/Kolkata" },
  enabled: true,
};

function schedulerApi() {
  const records = new Map<string, AwsSchedulerDefinition>();
  const key = (name: string, group?: string) => `${group ?? "default"}:${name}`;
  const get = vi.fn(async (name: string, group?: string) => records.get(key(name, group)) ?? null);
  const create = vi.fn(async (definition: AwsSchedulerDefinition) => {
    records.set(key(definition.name, definition.groupName), structuredClone(definition));
  });
  const update = vi.fn(async (definition: AwsSchedulerDefinition) => {
    records.set(key(definition.name, definition.groupName), structuredClone(definition));
  });
  const remove = vi.fn(async (name: string, group?: string) => { records.delete(key(name, group)); });
  const api: AwsSchedulerApi = { get, create, update, delete: remove };
  return { api, records, create, update };
}

const target = {
  queueArn: "arn:aws:sqs:ap-south-1:123456789012:automation-dispatch",
  schedulerRoleArn: "arn:aws:iam::123456789012:role/automation-scheduler",
  deadLetterQueueArn: "arn:aws:sqs:ap-south-1:123456789012:automation-dispatch-dlq",
  groupName: "automation-production",
};

describe("AWS scheduling and dispatch", () => {
  it("creates a tenant-scoped EventBridge schedule with exact-time context, bounded retries and DLQ", async () => {
    const { api, records } = schedulerApi();
    const adapter = new AwsEventBridgeSchedulerAdapter(api, target);
    await adapter.upsert(scope, registration);

    const definition = [...records.values()][0]!;
    expect(definition.name).toMatch(/^automation-[a-f0-9]{48}$/);
    expect(definition.scheduleExpressionTimezone).toBe("Asia/Kolkata");
    expect(definition.target).toMatchObject({
      arn: target.queueArn,
      deadLetterArn: target.deadLetterQueueArn,
      maximumEventAgeInSeconds: 3600,
      maximumRetryAttempts: 5,
    });
    expect(JSON.parse(definition.target.input)).toMatchObject({
      schemaVersion: 1,
      scope,
      automationId: "automation-a",
      scheduleKind: "CRON",
      scheduledAt: "<aws.scheduler.scheduled-time>",
      deliveryId: "<aws.scheduler.execution-id>",
    });
    await expect(adapter.get(scope, registration.scheduleId)).resolves.toEqual(registration);
  });

  it("uses different physical schedule names across ownership scopes", async () => {
    const { api, records } = schedulerApi();
    const adapter = new AwsEventBridgeSchedulerAdapter(api, target);
    await adapter.upsert(scope, registration);
    await adapter.upsert({ tenantId: "tenant-b", userId: "user-a" }, registration);
    expect(new Set([...records.values()].map((record) => record.name)).size).toBe(2);
  });

  it("updates an existing schedule rather than creating a duplicate", async () => {
    const { api, create, update } = schedulerApi();
    const adapter = new AwsEventBridgeSchedulerAdapter(api, target);
    await adapter.upsert(scope, registration);
    await adapter.upsert(scope, { ...registration, enabled: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("rejects schedule expressions that AWS Scheduler cannot execute", async () => {
    const { api, create } = schedulerApi();
    const adapter = new AwsEventBridgeSchedulerAdapter(api, target);
    await expect(adapter.upsert(scope, {
      ...registration,
      schedule: { ...registration.schedule, expression: "0 9 * * *" },
    })).rejects.toThrow("AWS schedule expression must use rate(...) or cron(...)");
    expect(create).not.toHaveBeenCalled();
  });

  it("deduplicates Step Functions executions by occurrence rather than Scheduler delivery attempt", async () => {
    const seen = new Set<string>();
    const calls: string[] = [];
    const api = {
      startExecution: async ({ name }: { stateMachineArn: string; name: string; input: string }) => {
        calls.push(name);
        if (seen.has(name)) throw Object.assign(new Error("duplicate"), { name: "ExecutionAlreadyExists" });
        seen.add(name);
        return { executionArn: `arn:execution:${name}` };
      },
    };
    const starter = new AwsStepFunctionsScheduledExecutionStarter(api, "arn:aws:states:ap-south-1:123456789012:stateMachine:automation");
    const first: ScheduledDispatchEnvelope = {
      schemaVersion: 1,
      scope,
      automationId: "automation-a",
      scheduleId: registration.scheduleId,
      scheduledAt: "2026-08-20T03:30:00.000Z",
      deliveryId: "attempt-1",
    };

    await expect(starter.start(first)).resolves.toMatchObject({ kind: "STARTED" });
    await expect(starter.start({ ...first, deliveryId: "attempt-2" })).resolves.toMatchObject({ kind: "DUPLICATE" });
    expect(calls[0]).toBe(calls[1]);
  });

  it("returns partial SQS batch failures so successful occurrences are not replayed", async () => {
    const start = vi.fn(async (envelope: ScheduledDispatchEnvelope) => {
      if (envelope.automationId === "bad") throw new Error("transient provider failure with secret detail");
      return { kind: "STARTED" as const, executionRef: "execution-ok" };
    });
    const handler = new AwsSqsScheduledDispatchHandler({ start });
    const body = (automationId: string) => JSON.stringify({
      schemaVersion: 1,
      scope,
      automationId,
      scheduleId: `automation:${automationId}`,
      scheduledAt: "2026-08-20T03:30:00.000Z",
      deliveryId: `delivery-${automationId}`,
    });

    await expect(handler.handle({ Records: [
      { messageId: "message-ok", body: body("automation-a") },
      { messageId: "message-bad", body: body("bad") },
    ] })).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "message-bad" }] });
    expect(start).toHaveBeenCalledTimes(2);
  });
});
