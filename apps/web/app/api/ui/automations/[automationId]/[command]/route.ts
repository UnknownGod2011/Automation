import { NextResponse } from "next/server";
import { WebControlPlaneError } from "../../../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../../../lib/mutation-security";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../lib/server-auth";

function redirectBack(request: Request, automationId: string, notice: string): NextResponse {
  return NextResponse.redirect(new URL(`/automations/${encodeURIComponent(automationId)}?notice=${encodeURIComponent(notice)}`, request.url), 303);
}

function positiveInteger(value: FormDataEntryValue | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request, context: { params: Promise<{ automationId: string; command: string }> }): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const { automationId, command } = await context.params;
  if (!automationId || !["capture", "compile", "test", "publish"].includes(command)) return new NextResponse("Not found", { status: 404 });
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

    if (command === "compile") {
      const traceId = String(form.get("traceId") ?? "").trim();
      const workflowId = String(form.get("workflowId") ?? "").trim();
      if (!traceId || !workflowId) return redirectBack(request, automationId, "invalid-input");
      await client.command(automationId, "compile", { traceId, workflowId });
      return redirectBack(request, automationId, "compiled");
    }

    if (command === "test") {
      const runId = String(form.get("runId") ?? "").trim();
      if (!runId) return redirectBack(request, automationId, "invalid-input");
      const rawVariables = String(form.get("runtimeVariables") ?? "").trim();
      let runtimeVariables: Record<string, unknown> | undefined;
      if (rawVariables) {
        const parsed: unknown = JSON.parse(rawVariables);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return redirectBack(request, automationId, "invalid-input");
        runtimeVariables = parsed as Record<string, unknown>;
      }
      await client.command(automationId, "test", { runId, ...(runtimeVariables ? { runtimeVariables } : {}) });
      return redirectBack(request, automationId, "tested");
    }

    const workflowVersion = positiveInteger(form.get("workflowVersion"));
    const kind = String(form.get("kind") ?? "");
    const expression = String(form.get("expression") ?? "").trim();
    const timezone = String(form.get("timezone") ?? "").trim();
    if (!workflowVersion || !["HOURLY", "DAILY", "WEEKLY", "CRON"].includes(kind) || !expression || !timezone) return redirectBack(request, automationId, "invalid-input");
    await client.command(automationId, "publish", { workflowVersion, schedule: { kind, expression, timezone } });
    return redirectBack(request, automationId, "published");
  } catch (error) {
    if (error instanceof WebAuthError) return NextResponse.redirect(new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}`)}`, request.url), 303);
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") return redirectBack(request, automationId, "not-configured");
    return redirectBack(request, automationId, "request-failed");
  }
}
