import Link from "next/link";
import { WebControlPlaneError } from "../../../../lib/control-plane-client";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function CaptureEvidencePage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  const backHref = `/automations/${encodeURIComponent(automationId)}`;

  let evidence;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    evidence = await client.captureEvidence(automationId);
  } catch (error) {
    if (error instanceof WebAuthError) {
      const returnTo = `${backHref}/capture-evidence`;
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to review this capture.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></section>;
    }
    const message = error instanceof WebControlPlaneError && error.code === "CONFLICT"
      ? "Capture evidence is temporarily unavailable. The completed capture remains intact."
      : "Capture evidence is unavailable or does not belong to this automation.";
    return <section className="card stack"><div className="eyebrow">Protected capture evidence</div><h1>Capture evidence unavailable</h1><p>{message}</p><Link className="button" href={backHref}>Back to automation</Link></section>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Protected capture evidence</div>
          <h1>Review captured actions</h1>
          <p>Inspect the latest trusted capture before spending a Fresh Test.</p>
          <p className="muted">Artifact, trace, Browser Profile, and browser-session identifiers stay server-side.</p>
          <Link href={backHref}>Back to automation</Link>
        </div>
      </section>

      <section className="card stack">
        {evidence.kind === "NONE" ? (
          <>
            <h2>No completed capture evidence yet</h2>
            <p className="muted">Finish a trusted cloud capture first. This view never treats an in-progress or canceled session as reviewable evidence.</p>
          </>
        ) : (
          <>
            <div className="row"><h2>Action screenshots</h2><span className="badge">{evidence.totalScreenshotCount} retained</span></div>
            <p className="muted">Capture completed {evidence.completedAt}. Authentication-setup and typed-input screenshots are excluded from this review boundary.</p>
            <p className="muted">Screenshots can contain ordinary page data visible during the workflow demonstration. They are supplementary teaching evidence; structural effect verification remains authoritative.</p>
            {evidence.items.length > 0 ? (
              <div className="list">
                {evidence.items.map((item) => (
                  <div className="list-item" key={item.ordinal}>
                    <div>
                      <div className="eyebrow">Screenshot {item.ordinal}</div>
                      <h3>{item.action}</h3>
                      <p className="muted">{item.occurredAt}</p>
                      <p className="muted">Origin: {item.origin ?? "Unavailable"}</p>
                    </div>
                    <Link href={`${backHref}/capture-evidence/${item.ordinal}`}>Open screenshot</Link>
                  </div>
                ))}
              </div>
            ) : <p className="muted">The completed capture has no reviewable CLICK/SUBMIT screenshots.</p>}
            {evidence.truncated ? <p className="muted">Only the first {evidence.items.length} screenshots are shown. The review surface is intentionally bounded.</p> : null}
          </>
        )}
      </section>
    </>
  );
}
