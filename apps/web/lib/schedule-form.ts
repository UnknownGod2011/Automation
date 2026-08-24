export type WebScheduleKind = "HOURLY" | "DAILY" | "WEEKLY" | "CRON";

export interface WebSchedule {
  kind: WebScheduleKind;
  expression: string;
  timezone: string;
}

const DAILY_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKLY_TIME = /^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(?:[01]\d|2[0-3]):[0-5]\d$/i;
const DAILY_CRON = /^cron\(([0-5]?\d) ([01]?\d|2[0-3]) \* \* \? \*\)$/;
const WEEKLY_CRON = /^cron\(([0-5]?\d) ([01]?\d|2[0-3]) \? \* (SUN|MON|TUE|WED|THU|FRI|SAT) \*\)$/;
const AWS_CRON = /^cron\(.+\)$/;

function bounded(value: FormDataEntryValue | null, maxLength = 160): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : "";
}

function clockParts(value: string): { hour: number; minute: number } | null {
  if (!DAILY_TIME.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined) return null;
  return { hour, minute };
}

function dailyExpression(value: string): string | null {
  if (DAILY_CRON.test(value)) return value;
  const time = clockParts(value);
  return time ? `cron(${time.minute} ${time.hour} * * ? *)` : null;
}

function weeklyExpression(value: string): string | null {
  if (WEEKLY_CRON.test(value)) return value;
  if (!WEEKLY_TIME.test(value)) return null;
  const [day, timeValue] = value.split(/\s+/, 2);
  if (!day || !timeValue) return null;
  const time = clockParts(timeValue);
  return time ? `cron(${time.minute} ${time.hour} ? * ${day.toUpperCase()} *)` : null;
}

export function scheduleFromFormData(form: FormData): WebSchedule | null {
  const kind = bounded(form.get("kind")) as WebScheduleKind;
  const expressionInput = bounded(form.get("expression"));
  const timezone = bounded(form.get("timezone"));
  if (!timezone || !["HOURLY", "DAILY", "WEEKLY", "CRON"].includes(kind)) return null;

  let expression: string | null;
  if (kind === "HOURLY") expression = "rate(1 hour)";
  else if (kind === "DAILY") expression = dailyExpression(expressionInput);
  else if (kind === "WEEKLY") expression = weeklyExpression(expressionInput);
  else expression = AWS_CRON.test(expressionInput) ? expressionInput : null;

  return expression ? { kind, expression, timezone } : null;
}

export function humanScheduleLabel(schedule: WebSchedule): string {
  if (schedule.kind === "HOURLY" && schedule.expression === "rate(1 hour)") {
    return `hourly · ${schedule.timezone}`;
  }

  const daily = DAILY_CRON.exec(schedule.expression);
  if (schedule.kind === "DAILY" && daily?.[1] && daily[2]) {
    const minute = daily[1].padStart(2, "0");
    const hour = daily[2].padStart(2, "0");
    return `daily at ${hour}:${minute} · ${schedule.timezone}`;
  }

  const weekly = WEEKLY_CRON.exec(schedule.expression);
  if (schedule.kind === "WEEKLY" && weekly?.[1] && weekly[2] && weekly[3]) {
    const minute = weekly[1].padStart(2, "0");
    const hour = weekly[2].padStart(2, "0");
    return `weekly ${weekly[3]} at ${hour}:${minute} · ${schedule.timezone}`;
  }

  return `${schedule.kind.toLowerCase()} · ${schedule.expression} · ${schedule.timezone}`;
}
