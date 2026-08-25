import Link from "next/link";
import { WebControlPlaneError } from "../../../../../lib/control-plane-client";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function CaptureEvidenceItemPage({
  params,
}: {
  params: Promise<{ automationId: string; ordinal: string }>;
}) {
  const { automationId, ordinal } = await params;
  const evidenceOrdinal = Number(ordinal);
  const backHref = `/automations/${encodeURIComponent(automationId)}/capture-evidence`;

  let evidence;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    evidence = await client.captureEvidenceItem(automationId, evidenceOrdinal);
  } catch (error) {
    if (error instanceof WebAuthError) {
      const returnTo = `${backHref}/${encodeURIComponent(ordinal)}`;
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect this capture evidence.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></section>;
    }
    const message = error instanceof WebControlPlaneError && error.code === "CONFLICT"
      ? "Capture evidence is temporarily unavailable. The completed capture remains intact."
      : "This capture evidence item is unavailable or no longer belongs to the latest trusted capture.";
    return <section className="card stack"><div className="eyebrow">Protected capture evidence</div><h1>Screenshot unavailable</h1><p>{message}</p><Link className="button" href={backHref}>Back to capture evidence</Link></section>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Protected capture evidence</div>
          <h1>{evidence.action} screenshot {evidence.ordinal}</h1>
          <p className="muted">{evidence.occurredAt} · {evidence.origin ?? "Origin unavailable"}</p>
          <p className="muted">The durable artifact reference is resolved from the latest completed capture and never appears in this URL.</p>
          <Link href={backHref}>Back to capture evidence</Link>
        </div>
      </section>

      <section className="card stack">
        {evidence.kind === "SCREENSHOT" ? (
          <>
            <h2>Captured browser state</h2>
            <p className="muted">{evidence.sizeBytes.toLocaleString()} bytes · image/png</p>
            <p className="muted">This can contain ordinary page content visible during your workflow demonstration. Typed-input and authentication-setup screenshots are excluded from this review boundary.</p>
            <img
              alt={`Capture evidence ${evidence.ordinal}`}
              src={`data:image/png;base64,${evidence.dataBase64}`}
              style={{ maxWidth: "100%", height: "auto", borderRadius: 12 }}
            />
          </>
        ) : (
          <>
            <h2>Protected screenshot</h2>
            <p>This evidence was retained, but it is not safe to preview through the product.</p>
            <p className="muted">{evidence.sizeBytes.toLocaleString()} bytes · {evidence.reason === "TOO_LARGE" ? "preview size limit exceeded" : "unsupported protected format"}</p>
          </>
        )}
      </section>
    </>
  );
}
