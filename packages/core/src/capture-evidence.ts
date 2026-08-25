import { assertCaptureTrace, type CaptureTrace } from "@automation/contracts";
import type { CaptureSessionRecord, CaptureSessionStore } from "./capture-completion.js";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type { ArtifactStore, AutomationRepository, OwnershipScope } from "./index.js";
import type { CaptureTraceRepository } from "./product-lifecycle.js";

export interface CaptureEvidenceIndexItemView {
  ordinal: number;
  action: "CLICK" | "SUBMIT";
  occurredAt: string;
  origin?: string;
}

export type CaptureEvidenceIndexView =
  | { kind: "NONE" }
  | {
      kind: "READY";
      completedAt: string;
      totalScreenshotCount: number;
      truncated: boolean;
      items: readonly CaptureEvidenceIndexItemView[];
    };

export type CaptureEvidenceView =
  | {
      kind: "SCREENSHOT";
      ordinal: number;
      action: "CLICK" | "SUBMIT";
      occurredAt: string;
      origin?: string;
      contentType: "image/png";
      sizeBytes: number;
      dataBase64: string;
    }
  | {
      kind: "PROTECTED";
      ordinal: number;
      action: "CLICK" | "SUBMIT";
      occurredAt: string;
      origin?: string;
      sizeBytes: number;
      reason: "UNSUPPORTED_FORMAT" | "TOO_LARGE";
    };

interface CaptureScreenshotEntry extends CaptureEvidenceIndexItemView {
  ref: string;
}

const MAX_CAPTURE_SCREENSHOTS = 200;
const MAX_REFERENCE_LENGTH = 1_024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

function ordinal(value: string): number {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    throw new ControlPlaneError("BAD_REQUEST", "capture evidence ordinal is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_CAPTURE_SCREENSHOTS) {
    throw new ControlPlaneError("BAD_REQUEST", "capture evidence ordinal is invalid");
  }
  return parsed;
}

function safeOrigin(value: string): string | undefined {
  if (value.length > 2_048) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function base64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const combined = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(combined >>> 18) & 63];
    output += BASE64_ALPHABET[(combined >>> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(combined >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : "=";
  }
  return output;
}

function assertCompletedCaptureIdentity(
  scope: OwnershipScope,
  automationId: string,
  session: CaptureSessionRecord,
): asserts session is CaptureSessionRecord & { traceId: string; completedAt: string } {
  if (
    session.tenantId !== scope.tenantId ||
    session.userId !== scope.userId ||
    session.automationId !== automationId ||
    session.status !== "COMPLETED" ||
    !session.traceId ||
    !session.completedAt
  ) {
    throw new ControlPlaneError("CONFLICT", "capture completion state is invalid");
  }
}

function assertTraceIdentity(
  scope: OwnershipScope,
  automationId: string,
  session: CaptureSessionRecord & { traceId: string },
  trace: CaptureTrace,
  automationProfileRef: string | undefined,
): void {
  try {
    assertCaptureTrace(trace);
  } catch {
    throw new ControlPlaneError("CONFLICT", "capture evidence trace is invalid");
  }
  if (
    trace.tenantId !== scope.tenantId ||
    trace.userId !== scope.userId ||
    trace.automationId !== automationId ||
    trace.traceId !== session.traceId ||
    trace.browserProfileRef !== session.browserProfileRef ||
    !automationProfileRef ||
    trace.browserProfileRef !== automationProfileRef
  ) {
    throw new ControlPlaneError("CONFLICT", "capture evidence identity is invalid");
  }
}

function captureScreenshots(trace: CaptureTrace): {
  entries: readonly CaptureScreenshotEntry[];
  totalScreenshotCount: number;
  truncated: boolean;
} {
  const entries: CaptureScreenshotEntry[] = [];
  let totalScreenshotCount = 0;

  for (const event of trace.events) {
    if (event.purpose !== "WORKFLOW" || (event.kind !== "CLICK" && event.kind !== "SUBMIT")) continue;
    for (const artifact of event.artifactRefs) {
      if (artifact.kind !== "SCREENSHOT" || artifact.contentType !== "image/png") continue;
      if (!artifact.ref || artifact.ref.length > MAX_REFERENCE_LENGTH) {
        throw new ControlPlaneError("CONFLICT", "capture evidence state is invalid");
      }
      totalScreenshotCount += 1;
      if (entries.length >= MAX_CAPTURE_SCREENSHOTS) continue;
      const origin = safeOrigin(event.page.url);
      entries.push({
        ordinal: entries.length + 1,
        action: event.kind,
        occurredAt: event.occurredAt,
        ...(origin ? { origin } : {}),
        ref: artifact.ref,
      });
    }
  }

  return {
    entries,
    totalScreenshotCount,
    truncated: totalScreenshotCount > entries.length,
  };
}

/**
 * Authenticated, read-only review of the latest durably completed workflow capture.
 * The browser selects only a bounded screenshot ordinal. Durable trace/artifact identifiers
 * are resolved from the owner-scoped completion pointer and capture trace server-side.
 * Authentication-setup events and typed-input events are deliberately excluded.
 */
export class CaptureEvidenceService {
  constructor(
    private readonly automations: AutomationRepository,
    private readonly sessions: CaptureSessionStore,
    private readonly captures: CaptureTraceRepository,
    private readonly artifacts: ArtifactStore,
  ) {}

  private async latest(
    scope: OwnershipScope,
    automationIdInput: string,
  ): Promise<{
    session: CaptureSessionRecord & { traceId: string; completedAt: string };
    trace: CaptureTrace;
  } | null> {
    const automationId = token(automationIdInput, "automationId");
    const automation = await this.automations.get(scope, automationId);
    if (!automation) throw new ControlPlaneError("NOT_FOUND", "capture evidence not found");

    let session: CaptureSessionRecord | null;
    try {
      session = await this.sessions.latestCompletedForAutomation(scope, automationId);
    } catch {
      throw new ControlPlaneError("CONFLICT", "capture evidence is temporarily unavailable");
    }
    if (!session) return null;
    assertCompletedCaptureIdentity(scope, automationId, session);

    let trace: CaptureTrace | null;
    try {
      trace = await this.captures.get(scope, automationId, session.traceId);
    } catch {
      throw new ControlPlaneError("CONFLICT", "capture evidence is temporarily unavailable");
    }
    if (!trace) throw new ControlPlaneError("CONFLICT", "capture evidence trace is unavailable");
    assertTraceIdentity(scope, automationId, session, trace, automation.browserProfileRef);
    return { session, trace };
  }

  async list(scope: OwnershipScope, automationId: string): Promise<CaptureEvidenceIndexView> {
    const latest = await this.latest(scope, automationId);
    if (!latest) return { kind: "NONE" };
    const screenshots = captureScreenshots(latest.trace);
    return {
      kind: "READY",
      completedAt: latest.session.completedAt,
      totalScreenshotCount: screenshots.totalScreenshotCount,
      truncated: screenshots.truncated,
      items: screenshots.entries.map(({ ref: _ref, ...item }) => item),
    };
  }

  async get(
    scope: OwnershipScope,
    automationId: string,
    ordinalInput: string,
  ): Promise<CaptureEvidenceView> {
    const evidenceOrdinal = ordinal(ordinalInput);
    const latest = await this.latest(scope, automationId);
    if (!latest) throw new ControlPlaneError("NOT_FOUND", "capture evidence not found");
    const entry = captureScreenshots(latest.trace).entries[evidenceOrdinal - 1];
    if (!entry) throw new ControlPlaneError("NOT_FOUND", "capture evidence not found");

    let bytes: Uint8Array | null;
    try {
      bytes = await this.artifacts.get(scope, entry.ref);
    } catch {
      throw new ControlPlaneError("CONFLICT", "capture evidence is temporarily unavailable");
    }
    if (!bytes) throw new ControlPlaneError("NOT_FOUND", "capture evidence not found");
    const context = {
      ordinal: entry.ordinal,
      action: entry.action,
      occurredAt: entry.occurredAt,
      ...(entry.origin ? { origin: entry.origin } : {}),
    } as const;
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return { ...context, kind: "PROTECTED", sizeBytes: bytes.byteLength, reason: "TOO_LARGE" };
    }
    if (!isPng(bytes)) {
      return { ...context, kind: "PROTECTED", sizeBytes: bytes.byteLength, reason: "UNSUPPORTED_FORMAT" };
    }
    return {
      ...context,
      kind: "SCREENSHOT",
      contentType: "image/png",
      sizeBytes: bytes.byteLength,
      dataBase64: base64(bytes),
    };
  }
}

function parts(path: string): readonly string[] {
  const clean = path.split("?", 1)[0] ?? "";
  try {
    return clean.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
}

function errorResponse(error: unknown): ControlPlaneHttpResponse {
  if (error instanceof ControlPlaneError) {
    const status = error.code === "BAD_REQUEST" ? 400 : error.code === "NOT_FOUND" ? 404 : 409;
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "control-plane request failed" } } };
}

export class CaptureEvidenceControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly evidence: CaptureEvidenceService,
  ) {}

  async handle(
    request: ControlPlaneHttpRequest,
    context: AuthenticatedControlPlaneContext,
  ): Promise<ControlPlaneHttpResponse> {
    const route = parts(request.path);
    if (
      route[0] !== "v1" ||
      route[1] !== "automations" ||
      !route[2] ||
      route[3] !== "capture-evidence" ||
      route.length < 4 ||
      route.length > 5
    ) {
      return this.base.handle(request, context);
    }
    if (request.method !== "GET") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }
    try {
      if (route.length === 4) {
        return { status: 200, body: await this.evidence.list(context.scope, route[2]) };
      }
      return { status: 200, body: await this.evidence.get(context.scope, route[2], route[4]!) };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
