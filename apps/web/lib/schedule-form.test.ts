import { describe, expect, it } from "vitest";
import { humanScheduleLabel, scheduleFromFormData } from "./schedule-form.js";

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe("schedule form normalization", () => {
  it("turns the default daily time into an EventBridge-compatible cron expression", () => {
    expect(scheduleFromFormData(form({
      kind: "DAILY",
      expression: "09:00",
      timezone: "Asia/Kolkata",
    }))).toEqual({
      kind: "DAILY",
      expression: "cron(0 9 * * ? *)",
      timezone: "Asia/Kolkata",
    });
  });

  it("uses one-hour rate semantics for hourly schedules without trusting the time field", () => {
    expect(scheduleFromFormData(form({
      kind: "HOURLY",
      expression: "09:00",
      timezone: "UTC",
    }))).toEqual({ kind: "HOURLY", expression: "rate(1 hour)", timezone: "UTC" });
  });

  it("accepts explicit weekday plus local time for weekly schedules", () => {
    expect(scheduleFromFormData(form({
      kind: "WEEKLY",
      expression: "fri 18:30",
      timezone: "Europe/London",
    }))).toEqual({
      kind: "WEEKLY",
      expression: "cron(30 18 ? * FRI *)",
      timezone: "Europe/London",
    });
  });

  it("preserves an explicit cron expression but rejects malformed custom schedules", () => {
    expect(scheduleFromFormData(form({
      kind: "CRON",
      expression: "cron(0 12 ? * MON-FRI *)",
      timezone: "America/New_York",
    }))).toEqual({
      kind: "CRON",
      expression: "cron(0 12 ? * MON-FRI *)",
      timezone: "America/New_York",
    });
    expect(scheduleFromFormData(form({ kind: "CRON", expression: "09:00", timezone: "UTC" }))).toBeNull();
    expect(scheduleFromFormData(form({ kind: "WEEKLY", expression: "09:00", timezone: "UTC" }))).toBeNull();
  });

  it("bounds untrusted form values before creating a schedule", () => {
    expect(scheduleFromFormData(form({
      kind: "DAILY",
      expression: "09:00",
      timezone: "x".repeat(161),
    }))).toBeNull();
  });

  it("renders normalized schedules as user-facing recurrence labels", () => {
    expect(humanScheduleLabel({
      kind: "DAILY",
      expression: "cron(5 9 * * ? *)",
      timezone: "Asia/Kolkata",
    })).toBe("daily at 09:05 · Asia/Kolkata");
    expect(humanScheduleLabel({
      kind: "WEEKLY",
      expression: "cron(30 18 ? * FRI *)",
      timezone: "Europe/London",
    })).toBe("weekly FRI at 18:30 · Europe/London");
  });
});
