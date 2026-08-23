import { NextResponse } from "next/server";
import { automationCreationId } from "../../../../lib/automation-creation-idempotency";
import { WebControlPlaneError } from "../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../lib/mutation-security";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../lib/server-auth";

function redirect(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const automationId = automationCreationId(form.get("creationRequestId"));
  const name = String(form.get("name") ?? "").trim();
  const websiteUrl = String(form.get("websiteUrl") ?? "").trim();
  const objective = String(form.get("objective") ?? "").trim();
  const consentAcknowledged = form.get("consentAcknowledged") === "true";
  if (!automationId || !name || !websiteUrl || !objective || !consentAcknowledged) {
    return redirect(request, "/automations/new?notice=request-failed");
  }

  const retryPath = `/automations/new?notice=request-failed&creationAttempt=${encodeURIComponent(automationId)}`;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    await client.create({ automationId, name, websiteUrl, objective, consentAcknowledged, notifyOnSuccess: form.get("notifyOnSuccess") === "true", notifyOnFailure: form.get("notifyOnFailure") === "true" });
    return redirect(request, `/automations/${encodeURIComponent(automationId)}?notice=created`);
  } catch (error) {
    if (error instanceof WebAuthError) return redirect(request, `/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/new?creationAttempt=${automationId}`)}`);
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") return redirect(request, `/automations/new?notice=not-configured&creationAttempt=${encodeURIComponent(automationId)}`);
    if (error instanceof WebControlPlaneError && error.code === "CONFLICT") {
      // The create API scopes duplicate detection to the authenticated owner. Replaying the
      // same server-generated creation identity therefore converges on the already-created draft.
      return redirect(request, `/automations/${encodeURIComponent(automationId)}?notice=created`);
    }
    return redirect(request, retryPath);
  }
}
