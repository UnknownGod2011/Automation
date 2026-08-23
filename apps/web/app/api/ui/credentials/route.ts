import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseWebByokProvider } from "../../../../lib/credential-form";
import { WebControlPlaneError } from "../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../lib/mutation-security";
import {
  createAuthenticatedWebControlPlaneClient,
  WebAuthError,
} from "../../../../lib/server-auth";

function redirect(request: Request, notice: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/settings/credentials?notice=${encodeURIComponent(notice)}`, request.url),
    303,
  );
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const action = text(form, "action");
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    if (action === "create") {
      const provider = parseWebByokProvider(form.get("provider"));
      const maskedLabel = text(form, "maskedLabel");
      const apiKey = String(form.get("apiKey") ?? "");
      const priority = Number(text(form, "priority"));
      if (
        !provider ||
        !maskedLabel ||
        !apiKey ||
        !Number.isInteger(priority) ||
        priority < 0 ||
        priority > 10_000
      ) {
        return redirect(request, "invalid-credential");
      }
      await client.createCredential({
        credentialId: randomUUID(),
        provider,
        apiKey,
        maskedLabel,
        priority,
      });
      return redirect(request, "credential-added");
    }

    const credentialId = text(form, "credentialId");
    if (!credentialId) return redirect(request, "invalid-credential");
    if (action === "rotate") {
      const apiKey = String(form.get("apiKey") ?? "");
      if (!apiKey) return redirect(request, "invalid-credential");
      await client.rotateCredential(credentialId, apiKey);
      return redirect(request, "credential-rotated");
    }
    if (action === "remove") {
      await client.removeCredential(credentialId);
      return redirect(request, "credential-removed");
    }
    return redirect(request, "invalid-action");
  } catch (error) {
    if (error instanceof WebAuthError) {
      return NextResponse.redirect(
        new URL("/api/auth/sign-in?returnTo=/settings/credentials", request.url),
        303,
      );
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return redirect(request, "not-configured");
    }
    return redirect(request, "request-failed");
  }
}
