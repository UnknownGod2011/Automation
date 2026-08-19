import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { WebControlPlaneClient, WebControlPlaneError } from "../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../lib/mutation-security";

function redirect(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const websiteUrl = String(form.get("websiteUrl") ?? "").trim();
  const objective = String(form.get("objective") ?? "").trim();
  const consentAcknowledged = form.get("consentAcknowledged") === "true";
  if (!name || !websiteUrl || !objective || !consentAcknowledged) {
    return redirect(request, "/automations/new?notice=request-failed");
  }

  const automationId = randomUUID();
  const client = new WebControlPlaneClient();
  try {
    await client.create({
      automationId,
      name,
      websiteUrl,
      objective,
      consentAcknowledged,
      notifyOnSuccess: form.get("notifyOnSuccess") === "true",
      notifyOnFailure: form.get("notifyOnFailure") === "true",
    });
    return redirect(request, `/automations/${encodeURIComponent(automationId)}?notice=created`);
  } catch (error) {
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return redirect(request, "/automations/new?notice=not-configured");
    }
    return redirect(request, "/automations/new?notice=request-failed");
  }
}
