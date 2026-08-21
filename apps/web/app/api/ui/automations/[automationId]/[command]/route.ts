import { NextResponse } from "next/server";
import { WebControlPlaneError } from "../../../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../../../lib/mutation-security";
import {
  freshTestRunId,
  serverResolvedPublishWorkflowVersion,
  workflowIdForAutomation,
} from "../../../../../../lib/product-flow-identities";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../lib/server-auth";

function redirectBack(request: Request, automationId: string, notice: string): NextResponse {
  return NextResponse.redirect(new URL(`/automations/${encodeURIComponent(automationId)}?notice=${encodeURIComponent(notice)}`, request.url), 303);
}

function scheduleFromForm(form: FormData): { kind: "HOURLY" | "DAILY" | "WEEKLY" | "CRON"; expression: string; timezone: string } | null {
  const kind = String(form.get("kind") ?? "");
  const expression = String(form.get("expression") ?? "").trim();
  const timezone = String(form.get("timezone") ?? "").trim();
  if (!["HOURLY", "DAILY", "WEEKLY", "CRON"].includes(kind) || !expression || !timezone) return null;
  return { kind: kind as "HOURLY" | "DAILY" | "WEEKLY" | "CRON", expression, timezone };
}

const COMMANDS = [
  "capture",
  "record-workflow",
  "finish-capture",
  "compile",
  "test",
  "publish",
  "schedule",
  "pause",
  "resume",
  "disable",
] as const;

export async function POST(request: Request, context: { params: Promise<{ automationId: string; command: string }> }): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const { automationId, command } = await context.params;
  if (!automationId || !COMMANDS.includes(command as (typeof COMMANDS)[number])) return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();

  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    if (command === "capture") {
      const result = await client.capture(automationId);
      if (result.kind === "NOT_CONFIGURED") return redirectBack(request, automationId, "not-configured");
      const liveView = new URL(result.liveViewUrl);
      if (liveView.protocol !== "https:") return redirectBack(request, automationId, "request-failed");
      return NextResponse.redirect(liveView, 303);
    }

    if (command === "record-workflow" || command === "finish-capture") {
      const captureSessionId = String(form.get("captureSessionId") ?? "").trim();
      if (!captureSessionId) return redirectBack(request, automationId, "invalid-input");
      if (command === "record-workflow") {
        await client.startCaptureRecording(automationId, captureSessionId);
        return redirectBack(request, automationId, "recording-started");
      }
      await client.finishCaptureRecording(automationId, captureSessionId);
      return redirectBack(request, automationId, "capture-finishing");
    }

    if (command === "compile") {
      const automation = await client.automation(automationId);
      const traceId = automation.latestCompletedCapture?.traceId;
      if (!traceId) return redirectBack(request, automationId, "invalid-input");
      await client.command(automationId, "compile", {
        traceId,
        workflowId: workflowIdForAutomation(automationId),
      });
      return redirectBack(request, automationId, "compiled");
    }

    if (command === "test") {
      const rawVariables = String(form.get("runtimeVariables") ?? "").trim();
      let runtimeVariables: Record<string, unknown> | undefined;
      if (rawVariables) {
        const parsed: unknown = JSON.parse(rawVariables);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return redirectBack(request, automationId, "invalid-input");
        runtimeVariables = parsed as Record<string, unknown>;
      }
      await client.command(automationId, "test", {
        runId: freshTestRunId(),
        ...(runtimeVariables ? { runtimeVariables } : {}),
      });
      return redirectBack(request, automationId, "tested");
    }

    if (command === "pause" || command === "resume" || command === "disable") {
      await client.command(automationId, command, {});
      return redirectBack(request, automationId, command === "pause" ? "paused" : command === "resume" ? "resumed" : "disabled");
    }

    const schedule = scheduleFromForm(form);
    if (!schedule) return redirectBack(request, automationId, "invalid-input");

    if (command === "schedule") {
      await client.command(automationId, "schedule", { schedule });
      return redirectBack(request, automationId, "schedule-updated");
    }

    const [automation, runs] = await Promise.all([
      client.automation(automationId),
      client.runs(automationId),
    ]);
    const workflowVersion = serverResolvedPublishWorkflowVersion(automation, runs);
    if (workflowVersion === null) return redirectBack(request, automationId, "invalid-input");
    await client.command(automationId, "publish", { workflowVersion, schedule });
    return redirectBack(request, automationId, "published");
  } catch (error) {
    if (error instanceof WebAuthError) return NextResponse.redirect(new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}`)}`, request.url), 303);
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") return redirectBack(request, automationId, "not-configured");
    return redirectBack(request, automationId, "request-failed");
  }
}
