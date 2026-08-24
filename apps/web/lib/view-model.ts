import type { AutomationSummaryView, ControlPlaneCapabilities, RunSummaryView } from "@automation/core";
import { humanScheduleLabel } from "./schedule-form";

const DAILY_CRON = /^cron\(([0-5]?\d) ([01]?\d|2[0-3]) \* \* \? \*\)$/;
const WEEKLY_CRON = /^cron\(([0-5]?\d) ([01]?\d|2[0-3]) \? \* (SUN|MON|TUE|WED|THU|FRI|SAT) \*\)$/;
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};
const REVISION_AUTHORING_STATUSES = new Set<AutomationSummaryView["status"]>([
  "CAPTURING",
  "COMPILING",
  "READY_TO_TEST",
  "TESTING",
  "READY_TO_PUBLISH",
]);
type RequiredDateTimePart = "year" | "month" | "day" | "hour" | "minute";

interface ZonedMinute {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function dateTimePart(parts: readonly Intl.DateTimeFormatPart[], type: RequiredDateTimePart): number | null {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function zonedMinute(date: Date, timezone: string): ZonedMinute | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const year = dateTimePart(parts, "year");
    const month = dateTimePart(parts, "month");
    const day = dateTimePart(parts, "day");
    const hour = dateTimePart(parts, "hour");
    const minute = dateTimePart(parts, "minute");
    if (year === null || month === null || day === null || hour === null || minute === null) return null;
    return { year, month, day, hour, minute };
  } catch {
    return null;
  }
}

function addCalendarDays(value: Pick<ZonedMinute, "year" | "month" | "day">, days: number) {
  const shifted = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function instantForLocalMinute(local: ZonedMinute, timezone: string): Date | null {
  const desired = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedMinute(new Date(candidate), timezone);
    if (!observed) return null;
    const represented = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const correction = desired - represented;
    if (correction === 0) break;
    candidate += correction;
  }
  const verified = zonedMinute(new Date(candidate), timezone);
  if (
    !verified ||
    verified.year !== local.year ||
    verified.month !== local.month ||
    verified.day !== local.day ||
    verified.hour !== local.hour ||
    verified.minute !== local.minute
  ) {
    return null;
  }
  return new Date(candidate);
}

function nextDailyOccurrence(expression: string, timezone: string, now: Date): Date | null {
  const match = DAILY_CRON.exec(expression);
  const current = zonedMinute(now, timezone);
  if (!match?.[1] || !match[2] || !current) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addCalendarDays(current, offset);
    const candidate = instantForLocalMinute({ ...day, hour, minute }, timezone);
    if (candidate && candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

function nextWeeklyOccurrence(expression: string, timezone: string, now: Date): Date | null {
  const match = WEEKLY_CRON.exec(expression);
  const current = zonedMinute(now, timezone);
  if (!match?.[1] || !match[2] || !match[3] || !current) return null;
  const targetWeekday = WEEKDAY_INDEX[match[3]];
  if (targetWeekday === undefined) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = addCalendarDays(current, offset);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday !== targetWeekday) continue;
    const candidate = instantForLocalMinute({ ...day, hour, minute }, timezone);
    if (candidate && candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

function nextHourlyOccurrence(lastScheduledAt: string | undefined, now: Date): Date | null {
  if (!lastScheduledAt) return null;
  const anchor = new Date(lastScheduledAt);
  if (Number.isNaN(anchor.getTime())) return null;
  if (anchor.getTime() > now.getTime()) return anchor;
  const hourMs = 60 * 60 * 1000;
  const elapsed = now.getTime() - anchor.getTime();
  const intervals = Math.floor(elapsed / hourMs) + 1;
  return new Date(anchor.getTime() + intervals * hourMs);
}

function formattedLocalMinute(date: Date, timezone: string): string | null {
  const local = zonedMinute(date, timezone);
  if (!local) return null;
  const datePart = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  const timePart = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return `${datePart} ${timePart} · ${timezone}`;
}

function hasRetainedDisabledRevisionSchedule(automation: AutomationSummaryView): boolean {
  return Boolean(
    automation.schedule &&
    automation.publishedWorkflowVersion !== undefined &&
    REVISION_AUTHORING_STATUSES.has(automation.status),
  );
}

export function formatCapability(label: string, state: ControlPlaneCapabilities[keyof ControlPlaneCapabilities]): string {
  return `${label}: ${state === "NOT_CONFIGURED" ? "Not configured" : state === "LOCAL_MOCK" ? "Local mock" : "Configured"}`;
}

export function formatSchedule(automation: AutomationSummaryView): string {
  const schedule = automation.schedule;
  if (!schedule) return "Not published";
  const label = humanScheduleLabel(schedule);
  return hasRetainedDisabledRevisionSchedule(automation) ? `${label} · disabled during revision` : label;
}

export function nextRunLabel(automation: AutomationSummaryView, now = new Date()): string {
  const schedule = automation.schedule;
  if (!schedule || automation.publishedWorkflowVersion === undefined) return "Next run: not scheduled";
  if (automation.status === "PAUSED") return "Next run: paused";
  if (automation.status === "DISABLED") return "Next run: disabled";
  if (hasRetainedDisabledRevisionSchedule(automation)) return "Next run: disabled during workflow revision";

  let candidate: Date | null = null;
  if (schedule.kind === "HOURLY" && schedule.expression === "rate(1 hour)") {
    const lastScheduledAt = automation.lastRun?.runKind === "SCHEDULED" ? automation.lastRun.scheduledAt : undefined;
    candidate = nextHourlyOccurrence(lastScheduledAt, now);
    if (!candidate) return `Next run: hourly from scheduler activation · ${schedule.timezone}`;
  } else if (schedule.kind === "DAILY") {
    candidate = nextDailyOccurrence(schedule.expression, schedule.timezone, now);
  } else if (schedule.kind === "WEEKLY") {
    candidate = nextWeeklyOccurrence(schedule.expression, schedule.timezone, now);
  } else {
    return `Next run: custom cron · ${schedule.timezone}`;
  }

  const formatted = candidate ? formattedLocalMinute(candidate, schedule.timezone) : null;
  return formatted ? `Next run: ${formatted}` : `Next run: schedule preview unavailable · ${schedule.timezone}`;
}

export function runTone(status: RunSummaryView["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "WAITING_FOR_HUMAN") return "warning";
  if (status === "FAILED" || status === "CANCELED") return "danger";
  return "neutral";
}

export function runKindLabel(run: Pick<RunSummaryView, "runKind">): string {
  if (run.runKind === "FRESH_TEST") return "Fresh test";
  if (run.runKind === "SCHEDULED") return "Scheduled run";
  return "Run";
}

export function runHistoryStatusDetail(run: Pick<RunSummaryView, "status" | "failureCode">): string {
  if (run.status === "SUCCEEDED") return "Verified successfully";
  if (run.status === "WAITING_FOR_HUMAN") {
    return run.failureCode ? `Needs attention · ${run.failureCode}` : "Paused safely for attention";
  }
  if (run.status === "FAILED") return run.failureCode ? `Failed · ${run.failureCode}` : "Execution failed";
  if (run.status === "CANCELED") return "Canceled";
  if (run.status === "SKIPPED") return run.failureCode ? `Skipped · ${run.failureCode}` : "Skipped";
  if (run.status === "QUEUED" || run.status === "PREFLIGHT") return "Preparing cloud execution";
  return "Execution in progress";
}

export type FreshTestFeedback =
  | { kind: "NONE" }
  | { kind: "RUNNING" | "PASSED" | "NEEDS_ATTENTION" | "NEEDS_CORRECTION"; run: RunSummaryView };

export function latestFreshTestFeedback(runs: readonly RunSummaryView[]): FreshTestFeedback {
  const latest = [...runs]
    .filter((run) => run.runKind === "FRESH_TEST")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];

  if (!latest) return { kind: "NONE" };
  if (latest.status === "SUCCEEDED") return { kind: "PASSED", run: latest };
  if (latest.status === "WAITING_FOR_HUMAN") return { kind: "NEEDS_ATTENTION", run: latest };
  if (latest.status === "FAILED" || latest.status === "CANCELED" || latest.status === "SKIPPED") {
    return { kind: "NEEDS_CORRECTION", run: latest };
  }
  return { kind: "RUNNING", run: latest };
}

export function automationPhase(automation: AutomationSummaryView): string {
  if (automation.needsAttention) return "Needs attention";

  switch (automation.status) {
    case "DRAFT":
      return "Draft";
    case "CAPTURING":
      return "Capturing";
    case "COMPILING":
      return "Compiling";
    case "READY_TO_TEST":
      return "Ready to test";
    case "TESTING":
      return "Testing";
    case "READY_TO_PUBLISH":
      return "Ready to publish";
    case "ACTIVE":
      return "Published";
    case "RUNNING":
      return "Running";
    case "PAUSED":
      return "Paused";
    case "NEEDS_AUTH":
      return "Needs sign-in";
    case "NEEDS_API_KEY":
      return "Needs API key";
    case "NEEDS_ATTENTION":
      return "Needs attention";
    case "DISABLED":
      return "Disabled";
  }
}
