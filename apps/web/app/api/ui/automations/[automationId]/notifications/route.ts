import { NextResponse } from "next/server";
import { WebControlPlaneError } from "../../../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../../../lib/mutation-security";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../lib/server-auth";

function redirectToSettings(request: Request, notice: string): NextResponse {
  return NextResponse.redirect(new URL(`/settings/notifications?notice=${encodeURIComponent(notice)}`, request.url), 303);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const { automationId } = await context.params;
  if (!automationId) return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();

  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    await client.updateNotificationPreferences(automationId, {
      notifyOnSuccess: form.get("notifyOnSuccess") === "yes",
      notifyOnFailure: form.get("notifyOnFailure") === "yes",
    });
    return redirectToSettings(request, "updated");
  } catch (error) {
    if (error instanceof WebAuthError) {
      return NextResponse.redirect(new URL("/api/auth/sign-in?returnTo=/settings/notifications", request.url), 303);
    }
    if (error instanceof WebControlPlaneError) return redirectToSettings(request, "request-failed");
    return redirectToSettings(request, "request-failed");
  }
}
