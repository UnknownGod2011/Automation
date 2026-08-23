import { NextResponse } from "next/server";
import { serverResolvedCaptureSessionId } from "../../../../../../lib/capture-command-state";
import { createCaptureLiveViewHandoff } from "../../../../../../lib/capture-live-view-handoff";
import { WebControlPlaneError } from "../../../../../../lib/control-plane-client";
import { hasUsableFreshTestCredential } from "../../../../../../lib/fresh-test-credential-readiness";
import { parseFreshTestRuntimeInputForm } from "../../../../../../lib/fresh-test-input-form";
import { isSameOriginMutation } from "../../../../../../lib/mutation-security";
import { freshTestRunId, serverResolvedPublishWorkflowVersion } from "../../../../../../lib/product-flow-identities";
import { scheduleFromFormData } from "../../../../../../lib/schedule-form";
import { parseScheduledInputForm } from "../../../../../../lib/scheduled-input-form";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../lib/server-auth";

function redirectBack(request: Request, automationId: string, notice: string): NextResponse { return NextResponse.redirect(new URL(`/automations/${encodeURIComponent(automationId)}?notice=${encodeURIComponent(notice)}`, request.url), 303); }
const COMMANDS = ["capture", "record-workflow", "finish-capture", "cancel-capture", "compile", "test", "publish", "schedule", "pause", "resume", "disable"] as const;

export async function POST(request: Request, context: { params: Promise<{ automationId: string; command: string }> }): Promise<Response> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const { automationId, command } = await context.params;
  if (!automationId || !COMMANDS.includes(command as (typeof COMMANDS)[number])) return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    if (command === "capture") {
      const result = await client.capture(automationId); if (result.kind === "NOT_CONFIGURED") return redirectBack(request, automationId, "not-configured");
      try { return createCaptureLiveViewHandoff(automationId, result.liveViewUrl); } catch { return redirectBack(request, automationId, "request-failed"); }
    }
    if (command === "cancel-capture") {
      await client.cancelCaptureRecording(automationId);
      return redirectBack(request, automationId, "capture-canceled");
    }
    if (command === "record-workflow" || command === "finish-capture") {
      const recording = await client.captureRecording(automationId); const captureSessionId = serverResolvedCaptureSessionId(recording, command);
      if (!captureSessionId) return redirectBack(request, automationId, "invalid-input");
      if (command === "record-workflow") { await client.startCaptureRecording(automationId, captureSessionId); return redirectBack(request, automationId, "recording-started"); }
      await client.finishCaptureRecording(automationId, captureSessionId); return redirectBack(request, automationId, "capture-finishing");
    }
    if (command === "compile") {
      await client.command(automationId, "compile", {});
      return redirectBack(request, automationId, "compiled");
    }
    if (command === "test") {
      const credentials = await client.credentials();
      if (!hasUsableFreshTestCredential(credentials)) {
        return NextResponse.redirect(new URL("/settings/credentials", request.url), 303);
      }
      const workflow = await client.workflow(automationId);
      if (!workflow) return redirectBack(request, automationId, "invalid-input");
      const runtimeVariables = parseFreshTestRuntimeInputForm(form, workflow.runtimeInputs);
      if (runtimeVariables === null) return redirectBack(request, automationId, "invalid-input");
      await client.command(automationId, "test", { runId: freshTestRunId(), ...(runtimeVariables ? { runtimeVariables } : {}) });
      return redirectBack(request, automationId, "tested");
    }
    if (command === "pause" || command === "resume" || command === "disable") {
      await client.command(automationId, command, {}); return redirectBack(request, automationId, command === "pause" ? "paused" : command === "resume" ? "resumed" : "disabled");
    }
    const schedule = scheduleFromFormData(form); if (!schedule) return redirectBack(request, automationId, "invalid-input");
    if (command === "schedule") { await client.command(automationId, "schedule", { schedule }); return redirectBack(request, automationId, "schedule-updated"); }

    const scheduledInputs = parseScheduledInputForm(
      String(form.get("scheduledNonSecretInputs") ?? ""),
      form.get("scheduledInputsAreNonSecret") === "yes",
    );
    if (!scheduledInputs) return redirectBack(request, automationId, "invalid-input");
    const [automation, runs] = await Promise.all([client.automation(automationId), client.runs(automationId)]);
    const workflowVersion = serverResolvedPublishWorkflowVersion(automation, runs);
    if (workflowVersion === null) return redirectBack(request, automationId, "invalid-input");
    await client.command(automationId, "publish", {
      workflowVersion,
      schedule,
      ...(scheduledInputs.values ? { scheduledNonSecretInputs: scheduledInputs.values } : {}),
      ...(scheduledInputs.acknowledged ? { scheduledInputsAreNonSecret: true } : {}),
    });
    return redirectBack(request, automationId, "published");
  } catch (error) {
    if (error instanceof WebAuthError) return NextResponse.redirect(new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}`)}`, request.url), 303);
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") return redirectBack(request, automationId, "not-configured");
    return redirectBack(request, automationId, "request-failed");
  }
}