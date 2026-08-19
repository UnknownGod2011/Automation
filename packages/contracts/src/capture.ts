import type { VerificationSpec } from "./index.js";

export const CAPTURE_EVENT_KINDS = ["NAVIGATION", "CLICK", "INPUT", "SUBMIT", "SCROLL"] as const;
export type CaptureEventKind = (typeof CAPTURE_EVENT_KINDS)[number];

export interface CaptureArtifactRef { ref: string; kind: "SCREENSHOT" | "DOM_SNAPSHOT" | "ACCESSIBILITY_SNAPSHOT" | "RECORDING"; contentType: string; }
export interface CaptureSemanticTarget { role?: string; accessibleName?: string; text?: string; testId?: string; css?: string; xpath?: string; }
export type CaptureInputValue = { kind: "PUBLIC_LITERAL"; value: string } | { kind: "RUNTIME_VARIABLE"; variableName: string; sensitive: boolean };
export interface CapturePageState { url: string; title?: string; fingerprint?: string; }

export interface CaptureEvent {
  eventId: string;
  sequence: number;
  kind: CaptureEventKind;
  purpose: "AUTH_SETUP" | "WORKFLOW";
  occurredAt: string;
  page: CapturePageState;
  target?: CaptureSemanticTarget;
  input?: CaptureInputValue;
  navigationUrl?: string;
  expectedEffect?: VerificationSpec;
  artifactRefs: readonly CaptureArtifactRef[];
}

export interface CaptureTrace {
  schemaVersion: 1;
  traceId: string;
  tenantId: string;
  userId: string;
  automationId: string;
  websiteUrl: string;
  objective: string;
  browserProfileRef: string;
  startedAt: string;
  finishedAt: string;
  events: readonly CaptureEvent[];
}

const MAX_FIELD_LENGTH = 2_048;
const MAX_CAPTURE_EVENTS = 1_000;
const MAX_ARTIFACT_REFS_PER_EVENT = 16;

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
  if (value.length > MAX_FIELD_LENGTH) throw new Error(`${name} exceeds maximum length`);
}

function assertIso(value: string, name: string): number {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) throw new Error(`${name} must be an ISO-8601 timestamp`);
  return time;
}

function assertHttpUrl(value: string, name: string): void {
  required(value, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use HTTP or HTTPS`);
}

function assertVerification(verification: VerificationSpec, name: string): void {
  required(verification.description, `${name}.description`);
  if (!Number.isFinite(verification.timeoutMs) || verification.timeoutMs <= 0) {
    throw new Error(`${name}.timeoutMs must be positive`);
  }
  if (verification.expected !== undefined) required(verification.expected, `${name}.expected`);
}

export function assertCaptureTrace(trace: CaptureTrace): void {
  required(trace.traceId, "traceId");
  required(trace.tenantId, "tenantId");
  required(trace.userId, "userId");
  required(trace.automationId, "automationId");
  required(trace.objective, "objective");
  required(trace.browserProfileRef, "browserProfileRef");
  assertHttpUrl(trace.websiteUrl, "websiteUrl");

  const startedAt = assertIso(trace.startedAt, "startedAt");
  const finishedAt = assertIso(trace.finishedAt, "finishedAt");
  if (finishedAt < startedAt) throw new Error("finishedAt cannot precede startedAt");
  if (trace.events.length === 0) throw new Error("capture trace requires at least one event");
  if (trace.events.length > MAX_CAPTURE_EVENTS) throw new Error(`capture trace cannot exceed ${MAX_CAPTURE_EVENTS} events`);

  let priorTime = startedAt;
  const eventIds = new Set<string>();
  for (let index = 0; index < trace.events.length; index += 1) {
    const event = trace.events[index]!;
    required(event.eventId, `events[${index}].eventId`);
    if (eventIds.has(event.eventId)) throw new Error(`duplicate capture event '${event.eventId}'`);
    eventIds.add(event.eventId);
    if (event.sequence !== index + 1) throw new Error("capture event sequence must be contiguous and one-based");

    const eventTime = assertIso(event.occurredAt, `events[${index}].occurredAt`);
    if (eventTime < priorTime || eventTime > finishedAt) throw new Error("capture event timestamps must be ordered within the trace window");
    priorTime = eventTime;

    assertHttpUrl(event.page.url, `events[${index}].page.url`);
    if (event.page.title !== undefined) required(event.page.title, `events[${index}].page.title`);
    if (event.page.fingerprint !== undefined) required(event.page.fingerprint, `events[${index}].page.fingerprint`);
    if (event.navigationUrl) assertHttpUrl(event.navigationUrl, `events[${index}].navigationUrl`);

    if ((event.kind === "CLICK" || event.kind === "INPUT" || event.kind === "SUBMIT") && !event.target) throw new Error(`${event.kind} capture event requires semantic target metadata`);
    if (event.kind === "INPUT" && !event.input) throw new Error("INPUT capture event requires an input descriptor");
    if (event.kind === "NAVIGATION" && !event.navigationUrl) throw new Error("NAVIGATION capture event requires navigationUrl");

    if (event.input?.kind === "PUBLIC_LITERAL") required(event.input.value, `events[${index}].input.value`);
    if (event.input?.kind === "RUNTIME_VARIABLE") required(event.input.variableName, `events[${index}].input.variableName`);
    for (const value of Object.values(event.target ?? {})) if (value !== undefined) required(value, `events[${index}].target field`);
    if (event.expectedEffect) assertVerification(event.expectedEffect, `events[${index}].expectedEffect`);

    if (event.artifactRefs.length > MAX_ARTIFACT_REFS_PER_EVENT) throw new Error(`capture event cannot exceed ${MAX_ARTIFACT_REFS_PER_EVENT} artifact references`);
    for (const artifact of event.artifactRefs) {
      required(artifact.ref, `events[${index}].artifact.ref`);
      required(artifact.contentType, `events[${index}].artifact.contentType`);
    }
  }
}
