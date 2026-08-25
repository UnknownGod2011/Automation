import type { WorkflowNode } from "@automation/contracts";
import { ControlPlaneError } from "./control-plane.js";
import type {
  AuthenticatedControlPlaneContext,
  ControlPlaneHttpRequest,
  ControlPlaneHttpResponse,
} from "./control-plane-http.js";
import type { ControlPlaneHttpHandlerPort } from "./capture-recording.js";
import type {
  ArtifactStore,
  CheckpointRepository,
  OwnershipScope,
  RunRepository,
} from "./index.js";

export type RunEvidenceView =
  | {
      kind: "SCREENSHOT";
      ordinal: number;
      contentType: "image/png";
      sizeBytes: number;
      dataBase64: string;
    }
  | {
      kind: "BROWSER_STATE";
      ordinal: number;
      sizeBytes: number;
      sequence: number;
      eventKind: string;
      nodeKind: WorkflowNode["kind"];
      origin?: string;
    }
  | {
      kind: "PROTECTED";
      ordinal: number;
      sizeBytes: number;
      reason: "UNSUPPORTED_FORMAT" | "TOO_LARGE";
    };

const MAX_EVIDENCE_REFS = 100;
const MAX_REFERENCE_LENGTH = 512;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const NODE_KINDS = new Set<WorkflowNode["kind"]>([
  "NAVIGATE",
  "CLICK",
  "TYPE",
  "EXTRACT",
  "REASON",
  "CONDITION",
  "LOOP",
  "VERIFY",
  "WAIT",
  "DOWNLOAD",
  "UPLOAD",
  "HUMAN",
  "SUBFLOW",
  "END",
]);

function token(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`);
  if (trimmed.length > 160) throw new ControlPlaneError("BAD_REQUEST", `${name} is too long`);
  return trimmed;
}

function ordinal(value: string): number {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) {
    throw new ControlPlaneError("BAD_REQUEST", "evidence ordinal is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_EVIDENCE_REFS) {
    throw new ControlPlaneError("BAD_REQUEST", "evidence ordinal is invalid");
  }
  return parsed;
}

function validateRefs(refs: readonly string[]): void {
  if (refs.length > MAX_EVIDENCE_REFS) {
    throw new ControlPlaneError("CONFLICT", "run evidence state is invalid");
  }
  for (const ref of refs) {
    if (!ref || ref.length > MAX_REFERENCE_LENGTH) {
      throw new ControlPlaneError("CONFLICT", "run evidence state is invalid");
    }
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

function safeOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== value) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function browserStateView(bytes: Uint8Array, evidenceOrdinal: number): RunEvidenceView | null {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  if (typeof record.kind !== "string" || !/^[A-Za-z0-9:_-]{1,64}$/.test(record.kind)) return null;
  if (typeof record.nodeKind !== "string" || !NODE_KINDS.has(record.nodeKind as WorkflowNode["kind"])) return null;
  if (typeof record.sequence !== "number" || !Number.isInteger(record.sequence) || record.sequence < 1 || record.sequence > 1_000_000) return null;
  const origin = safeOrigin(record.origin);
  return {
    kind: "BROWSER_STATE",
    ordinal: evidenceOrdinal,
    sizeBytes: bytes.byteLength,
    sequence: record.sequence,
    eventKind: record.kind,
    nodeKind: record.nodeKind as WorkflowNode["kind"],
    ...(origin ? { origin } : {}),
  };
}

/**
 * Authenticated, read-only evidence access. The browser selects only a 1-based ordinal;
 * durable artifact references are resolved from the authorized checkpoint server-side.
 * Known Playwright metadata is reduced to a closed safe schema and screenshots are
 * bounded before base64 encoding. Unknown evidence remains opaque.
 */
export class RunEvidenceService {
  constructor(
    private readonly runs: RunRepository,
    private readonly checkpoints: CheckpointRepository,
    private readonly artifacts: ArtifactStore,
  ) {}

  async get(
    scope: OwnershipScope,
    automationIdInput: string,
    runIdInput: string,
    ordinalInput: string,
  ): Promise<RunEvidenceView> {
    const automationId = token(automationIdInput, "automationId");
    const runId = token(runIdInput, "runId");
    const evidenceOrdinal = ordinal(ordinalInput);
    const run = await this.runs.get(scope, runId);
    if (!run || run.automationId !== automationId) {
      throw new ControlPlaneError("NOT_FOUND", "run evidence not found");
    }
    const checkpoint = await this.checkpoints.get(scope, runId);
    if (
      !checkpoint ||
      checkpoint.runId !== run.runId ||
      checkpoint.automationId !== run.automationId ||
      checkpoint.workflowVersion !== run.workflowVersion
    ) {
      if (!checkpoint) throw new ControlPlaneError("NOT_FOUND", "run evidence not found");
      throw new ControlPlaneError("CONFLICT", "run checkpoint identity is invalid");
    }
    validateRefs(checkpoint.evidenceRefs);
    const ref = checkpoint.evidenceRefs[evidenceOrdinal - 1];
    if (!ref) throw new ControlPlaneError("NOT_FOUND", "run evidence not found");

    let bytes: Uint8Array | null;
    try {
      bytes = await this.artifacts.get(scope, ref);
    } catch {
      throw new ControlPlaneError("CONFLICT", "run evidence is temporarily unavailable");
    }
    if (!bytes) throw new ControlPlaneError("NOT_FOUND", "run evidence not found");
    if (bytes.byteLength > MAX_PREVIEW_BYTES) {
      return { kind: "PROTECTED", ordinal: evidenceOrdinal, sizeBytes: bytes.byteLength, reason: "TOO_LARGE" };
    }
    if (isPng(bytes)) {
      return {
        kind: "SCREENSHOT",
        ordinal: evidenceOrdinal,
        contentType: "image/png",
        sizeBytes: bytes.byteLength,
        dataBase64: base64(bytes),
      };
    }
    const metadata = browserStateView(bytes, evidenceOrdinal);
    if (metadata) return metadata;
    return {
      kind: "PROTECTED",
      ordinal: evidenceOrdinal,
      sizeBytes: bytes.byteLength,
      reason: "UNSUPPORTED_FORMAT",
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

export class RunEvidenceControlPlaneHttpHandler implements ControlPlaneHttpHandlerPort {
  constructor(
    private readonly base: ControlPlaneHttpHandlerPort,
    private readonly evidence: RunEvidenceService,
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
      route[3] !== "runs" ||
      !route[4] ||
      route[5] !== "evidence" ||
      !route[6] ||
      route.length !== 7
    ) {
      return this.base.handle(request, context);
    }
    if (request.method !== "GET") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    }
    try {
      return { status: 200, body: await this.evidence.get(context.scope, route[2], route[4], route[6]) };
    } catch (error) {
      return errorResponse(error);
    }
  }
}
