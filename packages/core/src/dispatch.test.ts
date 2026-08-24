import { describe, expect, it, vi } from "vitest";
import {
  ScheduledDispatchService,
  parseScheduledDispatchEnvelope,
  type ScheduledExecutionStarter,
} from "./dispatch.js";

const payload = {
  schemaVersion: 1,
  scope: { tenantId: "tenant-a", userId: "user-a" },
  automationId: "automation-a",
  scheduleId: "automation:automation-a",
  scheduledAt: "2026-08-20T01:30:00+05:30",
  deliveryId: "delivery-1",
} as const;

describe("scheduled dispatch contract", () => {
  it("normalizes the scheduled occurrence and preserves trusted ownership", () => {
    expect(parseScheduledDispatchEnvelope(payload)).toEqual({
      ...payload,
      scheduledAt: "2026-08-19T20:00:00.000Z",
    });
  });

  it.each([
    [{ ...payload, schemaVersion: 2 }, "unsupported scheduled dispatch schema version"],
    [{ ...payload, scope: { tenantId: "", userId: "user-a" } }, "tenantId is required"],
    [{ ...payload, scheduledAt: "tomorrow" }, "scheduledAt must be an ISO-8601 timestamp"],
    [{ ...payload, deliveryId: "" }, "deliveryId is required"],
  ])("rejects malformed transport payloads", (value, message) => {
    expect(() => parseScheduledDispatchEnvelope(value)).toThrow(message);
  });

  it("validates before durable orchestration is started", async () => {
    const start = vi.fn<ScheduledExecutionStarter["start"]>(async () => ({
      kind: "STARTED",
      executionRef: "execution-1",
    }));
    const service = new ScheduledDispatchService({ start });

    await expect(service.handle({ ...payload, automationId: "" })).rejects.toThrow("automationId is required");
    expect(start).not.toHaveBeenCalled();

    await expect(service.handle(payload)).resolves.toEqual({ kind: "STARTED", executionRef: "execution-1" });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
