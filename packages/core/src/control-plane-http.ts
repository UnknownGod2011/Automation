import type { AutomationSchedule } from "@automation/contracts";
import type { OwnershipScope } from "./index.js";
import {
  AutomationControlPlaneService,
  ControlPlaneError,
  type CreateAutomationCommand,
  type CreateCredentialCommand,
  type PublishAutomationCommand,
  type RotateCredentialCommand,
  type TestAutomationCommand,
  type UpdateAutomationScheduleCommand,
  type UpdateNotificationPreferencesCommand,
  type UpdateScheduledInputValuesCommand,
} from "./control-plane.js";

export interface ControlPlaneHttpRequest { method: "GET" | "POST"; path: string; body?: unknown; }
export interface AuthenticatedControlPlaneContext { scope: OwnershipScope; }
export interface ControlPlaneHttpResponse { status: number; body: unknown; }
function jsonObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ControlPlaneError("BAD_REQUEST", "request body must be a JSON object"); return value as Record<string, unknown>; }
function stringField(body: Record<string, unknown>, name: string): string { const value = body[name]; if (typeof value !== "string") throw new ControlPlaneError("BAD_REQUEST", `${name} must be a string`); return value; }
function booleanField(body: Record<string, unknown>, name: string): boolean | undefined { const value = body[name]; if (value === undefined) return undefined; if (typeof value !== "boolean") throw new ControlPlaneError("BAD_REQUEST", `${name} must be a boolean`); return value; }
function requiredBooleanField(body: Record<string, unknown>, name: string): boolean { const value = booleanField(body, name); if (value === undefined) throw new ControlPlaneError("BAD_REQUEST", `${name} is required`); return value; }
function integerField(body: Record<string, unknown>, name: string): number { const value = body[name]; if (!Number.isInteger(value) || (value as number) < 1) throw new ControlPlaneError("BAD_REQUEST", `${name} must be a positive integer`); return value as number; }
function priorityField(body: Record<string, unknown>): number { const value = body.priority; if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) throw new ControlPlaneError("BAD_REQUEST", "priority must be an integer between 0 and 10000"); return value as number; }
function stringMapField(body: Record<string, unknown>, name: string): Readonly<Record<string, string>> | undefined {
  const value = body[name]; if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ControlPlaneError("BAD_REQUEST", `${name} must be a JSON object`);
  const entries = Object.entries(value as Record<string, unknown>); if (entries.length > 64) throw new ControlPlaneError("BAD_REQUEST", `${name} has too many values`);
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) { if (typeof entry !== "string") throw new ControlPlaneError("BAD_REQUEST", `${name} values must be strings`); result[key] = entry; }
  return result;
}
function scheduleField(value: unknown): AutomationSchedule {
  const schedule = jsonObject(value); const kind = stringField(schedule, "kind");
  if (kind !== "HOURLY" && kind !== "DAILY" && kind !== "WEEKLY" && kind !== "CRON") throw new ControlPlaneError("BAD_REQUEST", "schedule kind is invalid");
  return { kind, expression: stringField(schedule, "expression"), timezone: stringField(schedule, "timezone") };
}
function routeParts(path: string): readonly string[] { const clean = path.split("?", 1)[0] ?? ""; return clean.split("/").filter(Boolean).map(decodeURIComponent); }
function errorResponse(error: unknown): ControlPlaneHttpResponse {
  if (error instanceof ControlPlaneError) { const status = error.code === "BAD_REQUEST" ? 400 : error.code === "NOT_FOUND" ? 404 : error.code === "NOT_CONFIGURED" ? 503 : 409; return { status, body: { error: { code: error.code, message: error.message } } }; }
  return { status: 500, body: { error: { code: "INTERNAL", message: "control-plane request failed" } } };
}
function generatedFreshTestRunId(factory: () => string): string {
  const runId = factory().trim();
  if (!/^test-[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) {
    throw new ControlPlaneError("CONFLICT", "fresh-test run identity could not be generated");
  }
  return runId;
}

export class AutomationControlPlaneHttpHandler {
  constructor(
    private readonly service: AutomationControlPlaneService,
    private readonly freshTestRunIdFactory: () => string = () => `test-${globalThis.crypto.randomUUID()}`,
  ) {}
  async handle(request: ControlPlaneHttpRequest, context: AuthenticatedControlPlaneContext): Promise<ControlPlaneHttpResponse> {
    try {
      const parts = routeParts(request.path);
      if (parts[0] !== "v1") return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
      if (parts[1] === "credentials") {
        if (request.method === "GET" && parts.length === 2) return { status: 200, body: { credentials: await this.service.listCredentials(context.scope) } };
        if (request.method === "POST" && parts.length === 2) {
          const body = jsonObject(request.body); const command: CreateCredentialCommand = { credentialId: stringField(body, "credentialId"), provider: stringField(body, "provider"), apiKey: stringField(body, "apiKey"), maskedLabel: stringField(body, "maskedLabel"), priority: priorityField(body) };
          return { status: 201, body: await this.service.createCredential(context.scope, command) };
        }
        const credentialId = parts[2];
        if (credentialId && request.method === "POST" && parts.length === 4) {
          if (parts[3] === "rotate") { const body = jsonObject(request.body); const command: RotateCredentialCommand = { apiKey: stringField(body, "apiKey") }; return { status: 200, body: await this.service.rotateCredential(context.scope, credentialId, command) }; }
          if (parts[3] === "remove") return { status: 200, body: await this.service.removeCredential(context.scope, credentialId) };
        }
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
      }
      if (parts[1] !== "automations") return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
      if (request.method === "GET" && parts.length === 2) return { status: 200, body: await this.service.dashboard(context.scope) };
      if (request.method === "POST" && parts.length === 2) {
        const body = jsonObject(request.body); const notifyOnSuccess = booleanField(body, "notifyOnSuccess"); const notifyOnFailure = booleanField(body, "notifyOnFailure");
        const command: CreateAutomationCommand = { automationId: stringField(body, "automationId"), name: stringField(body, "name"), websiteUrl: stringField(body, "websiteUrl"), objective: stringField(body, "objective"), consentAcknowledged: booleanField(body, "consentAcknowledged") ?? false, ...(notifyOnSuccess !== undefined ? { notifyOnSuccess } : {}), ...(notifyOnFailure !== undefined ? { notifyOnFailure } : {}) };
        return { status: 201, body: await this.service.createAutomation(context.scope, command) };
      }
      const automationId = parts[2]; if (!automationId) return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
      if (request.method === "GET" && parts.length === 3) return { status: 200, body: await this.service.getAutomation(context.scope, automationId) };
      if (request.method === "POST" && parts[3] === "notifications" && parts.length === 4) {
        const body = jsonObject(request.body);
        const command: UpdateNotificationPreferencesCommand = {
          notifyOnSuccess: requiredBooleanField(body, "notifyOnSuccess"),
          notifyOnFailure: requiredBooleanField(body, "notifyOnFailure"),
        };
        return { status: 200, body: await this.service.updateNotificationPreferences(context.scope, automationId, command) };
      }
      if (request.method === "POST" && parts[3] === "scheduled-inputs" && parts.length === 4) {
        const body = jsonObject(request.body);
        const scheduledNonSecretInputs = stringMapField(body, "scheduledNonSecretInputs");
        if (scheduledNonSecretInputs === undefined) throw new ControlPlaneError("BAD_REQUEST", "scheduledNonSecretInputs is required");
        const command: UpdateScheduledInputValuesCommand = {
          scheduledNonSecretInputs,
          scheduledInputsAreNonSecret: requiredBooleanField(body, "scheduledInputsAreNonSecret"),
        };
        return { status: 200, body: await this.service.updateScheduledInputValues(context.scope, automationId, command) };
      }
      if (request.method === "POST" && parts[3] === "capture" && parts.length === 4) { const result = await this.service.beginCapture(context.scope, automationId); return result.kind === "READY" ? { status: 201, body: result } : { status: 503, body: result }; }
      if (request.method === "POST" && parts[3] === "compile" && parts.length === 4) return { status: 200, body: await this.service.compileAutomation(context.scope, automationId) };
      if (request.method === "POST" && parts[3] === "test" && parts.length === 4) {
        const body = jsonObject(request.body); const runtimeVariables = body.runtimeVariables;
        if (runtimeVariables !== undefined && (!runtimeVariables || typeof runtimeVariables !== "object" || Array.isArray(runtimeVariables))) throw new ControlPlaneError("BAD_REQUEST", "runtimeVariables must be a JSON object");
        const command: TestAutomationCommand = { runId: generatedFreshTestRunId(this.freshTestRunIdFactory), ...(runtimeVariables ? { runtimeVariables: runtimeVariables as Readonly<Record<string, unknown>> } : {}) };
        return { status: 200, body: await this.service.runFreshTest(context.scope, automationId, command) };
      }
      if (request.method === "POST" && parts[3] === "publish" && parts.length === 4) {
        const body = jsonObject(request.body); const scheduledNonSecretInputs = stringMapField(body, "scheduledNonSecretInputs"); const scheduledInputsAreNonSecret = booleanField(body, "scheduledInputsAreNonSecret");
        const command: PublishAutomationCommand = { workflowVersion: integerField(body, "workflowVersion"), schedule: scheduleField(body.schedule), ...(scheduledNonSecretInputs !== undefined ? { scheduledNonSecretInputs } : {}), ...(scheduledInputsAreNonSecret !== undefined ? { scheduledInputsAreNonSecret } : {}) };
        return { status: 200, body: await this.service.publishAutomation(context.scope, automationId, command) };
      }
      if (request.method === "POST" && parts[3] === "schedule" && parts.length === 4) { const body = jsonObject(request.body); const command: UpdateAutomationScheduleCommand = { schedule: scheduleField(body.schedule) }; return { status: 200, body: await this.service.updateAutomationSchedule(context.scope, automationId, command) }; }
      if (request.method === "POST" && parts.length === 4) {
        if (parts[3] === "pause") return { status: 200, body: await this.service.pauseAutomation(context.scope, automationId) };
        if (parts[3] === "resume") return { status: 200, body: await this.service.resumeAutomation(context.scope, automationId) };
        if (parts[3] === "disable") return { status: 200, body: await this.service.disableAutomation(context.scope, automationId) };
      }
      if (request.method === "GET" && parts[3] === "runs" && parts.length === 4) return { status: 200, body: { runs: await this.service.history(context.scope, automationId) } };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "route not found" } } };
    } catch (error) { return errorResponse(error); }
  }
}
