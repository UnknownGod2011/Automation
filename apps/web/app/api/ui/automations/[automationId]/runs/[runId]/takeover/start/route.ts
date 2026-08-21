import { NextResponse } from "next/server";
import { WebControlPlaneError } from "../../../../../../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../../../../../../lib/mutation-security";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../../../../lib/server-auth";

function runPath(automationId: string, runId: string): string {
  return `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`;
}
function redirectBack(request: Request, automationId: string, runId: string, notice: string): NextResponse {
  return NextResponse.redirect(new URL(`${runPath(automationId, runId)}?notice=${encodeURIComponent(notice)}`, request.url), 303);
}
function safeLiveView(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, context: { params: Promise<{ automationId: string; runId: string }> }): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const { automationId, runId } = await context.params;
  if (!automationId || !runId) return new NextResponse("Not found", { status: 404 });
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    const result = await client.startHumanTakeover(automationId, runId);
    const liveView = safeLiveView(result.liveViewUrl);
    if (!liveView) return redirectBack(request, automationId, runId, "takeover-failed");
    return NextResponse.redirect(liveView, 303);
  } catch (error) {
    if (error instanceof WebAuthError) {
      return NextResponse.redirect(new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(runPath(automationId, runId))}`, request.url), 303);
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return redirectBack(request, automationId, runId, "takeover-failed");
    }
    return redirectBack(request, automationId, runId, "takeover-failed");
  }
}
