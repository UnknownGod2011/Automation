import { NextResponse } from "next/server";
import { WebControlPlaneError } from "../../../../../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../../../../../lib/mutation-security";
import { serverResolvedHumanResumeNode } from "../../../../../../../../lib/run-resume-state";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../../../lib/server-auth";

function redirectBack(request: Request, automationId: string, runId: string, notice: string): NextResponse {
  const path = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}?notice=${encodeURIComponent(notice)}`;
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ automationId: string; runId: string }> },
): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { automationId, runId } = await context.params;
  if (!automationId || !runId) return new NextResponse("Not found", { status: 404 });

  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    const run = await client.run(automationId, runId);
    const expectedNodeId = serverResolvedHumanResumeNode(run);
    if (!expectedNodeId) return redirectBack(request, automationId, runId, "resume-failed");
    const result = await client.resumeRun(automationId, runId, expectedNodeId);
    return redirectBack(
      request,
      automationId,
      runId,
      result.kind === "CONFLICT" ? "resume-failed" : "resume-submitted",
    );
  } catch (error) {
    if (error instanceof WebAuthError) {
      const returnTo = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`;
      return NextResponse.redirect(
        new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.url),
        303,
      );
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return redirectBack(request, automationId, runId, "resume-failed");
    }
    return redirectBack(request, automationId, runId, "resume-failed");
  }
}
