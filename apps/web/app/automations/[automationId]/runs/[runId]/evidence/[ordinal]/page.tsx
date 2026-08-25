import Link from "next/link";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../../lib/server-auth";
import { WebControlPlaneError } from "../../../../../../../lib/control-plane-client";

export const dynamic = "force-dynamic";

export default async function RunEvidencePage({
  params,
}: {
  params: Promise<{ automationId: string; runId: string; ordinal: string }>;
}) {
  const { automationId, runId, ordinal } = await params;
  const evidenceOrdinal = Number(ordinal);
  const backHref = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`;

  let evidence;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    evidence = await client.runEvidence(automationId, runId, evidenceOrdinal);
  } catch (error) {
    if (error instanceof WebAuthError) {
      const returnTo = `${backHref}/evidence/${encodeURIComponent(ordinal)}`;
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect this evidence.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></section>;
    }
    const message = error instanceof WebControlPlaneError && error.code === "CONFLICT"
      ? "Evidence is temporarily unavailable. The durable run remains intact."
      : "This evidence item is unavailable or no longer belongs to the authorized run.";
    return <section className="card stack"><div className="eyebrow">Protected run evidence</div><h1>Evidence unavailable</h1><p>{message}</p><Link className="button" href={backHref}>Back to run</Link></section>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Protected run evidence</div>
          <h1>Evidence item {evidence.ordinal}</h1>
          <p className="muted">This view is authenticated and resolved from the durable run checkpoint. Storage identifiers remain server-side.</p>
          <Link href={backHref}>Back to run</Link>
        </div>
      </section>

      <section className="card stack">
        {evidence.kind === "SCREENSHOT" ? (
          <>
            <h2>Browser screenshot</h2>
            <p className="muted">{evidence.sizeBytes.toLocaleString()} bytes · image/png</p>
            <p className="muted">Screenshots can contain page content visible to your authenticated browser session. They are shown only to the automation owner and are not embedded in URLs or logs.</p>
            <img
              alt={`Run evidence ${evidence.ordinal}`}
              src={`data:image/png;base64,${evidence.dataBase64}`}
              style={{ maxWidth: "100%", height: "auto", borderRadius: 12 }}
            />
          </>
        ) : evidence.kind === "BROWSER_STATE" ? (
          <>
            <h2>Browser state metadata</h2>
            <div className="row"><span>Recorded event</span><strong>{evidence.eventKind}</strong></div>
            <div className="row"><span>Workflow action</span><strong>{evidence.nodeKind}</strong></div>
            <div className="row"><span>Sequence</span><span>{evidence.sequence}</span></div>
            <div className="row"><span>Origin</span><span>{evidence.origin ?? "Unavailable"}</span></div>
            <p className="muted">Raw DOM, page text, selectors, state fingerprints, workflow node IDs, and artifact references are intentionally excluded.</p>
          </>
        ) : (
          <>
            <h2>Protected evidence</h2>
            <p>This item was recorded, but its format is not safe to preview through the product.</p>
            <p className="muted">{evidence.sizeBytes.toLocaleString()} bytes · {evidence.reason === "TOO_LARGE" ? "preview size limit exceeded" : "unsupported protected format"}</p>
          </>
        )}
      </section>
    </>
  );
}
