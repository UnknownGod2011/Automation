import { NextResponse } from "next/server";
import {
  credentialCreationId,
  matchesCredentialCreateReplay,
} from "../../../../lib/credential-creation-idempotency";
import { parseWebByokProvider } from "../../../../lib/credential-form";
import { WebControlPlaneError } from "../../../../lib/control-plane-client";
import { isSameOriginMutation } from "../../../../lib/mutation-security";
import {
  createAuthenticatedWebControlPlaneClient,
  WebAuthError,
} from "../../../../lib/server-auth";

function redirect(request: Request, notice: string, creationAttempt?: string): NextResponse {
  const params = new URLSearchParams({ notice });
  if (creationAttempt) params.set("creationAttempt", creationAttempt);
  return NextResponse.redirect(
    new URL(`/settings/credentials?${params.toString()}`, request.url),
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
  const creationAttempt = credentialCreationId(form.get("creationRequestId"));
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    if (action === "create") {
      const provider = parseWebByokProvider(form.get("provider"));
      const maskedLabel = text(form, "maskedLabel");
      const apiKey = String(form.get("apiKey") ?? "");
      const priority = Number(text(form, "priority"));
      if (
        !creationAttempt ||
        !provider ||
        !maskedLabel ||
        !apiKey ||
        !Number.isInteger(priority) ||
        priority < 0 ||
        priority > 10_000
      ) {
        return redirect(request, "invalid-credential", creationAttempt ?? undefined);
      }
      const intent = {
        credentialId: creationAttempt,
        provider,
        maskedLabel,
        priority,
      };
      try {
        await client.createCredential({ ...intent, apiKey });
      } catch (error) {
        if (!(error instanceof WebControlPlaneError) || error.code !== "CONFLICT") throw error;
        const existing = (await client.credentials()).find((credential) => credential.credentialId === creationAttempt);
        if (!existing || !matchesCredentialCreateReplay(existing, intent)) throw error;
      }
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
      const returnTo = creationAttempt
        ? `/settings/credentials?creationAttempt=${encodeURIComponent(creationAttempt)}`
        : "/settings/credentials";
      return NextResponse.redirect(
        new URL(`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.url),
        303,
      );
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return redirect(request, "not-configured", creationAttempt ?? undefined);
    }
    return redirect(request, "request-failed", creationAttempt ?? undefined);
  }
}
