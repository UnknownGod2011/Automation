import Link from "next/link";
import { WebControlPlaneError } from "../../../../../../lib/control-plane-client";
import { semanticRecoveryProof } from "../../../../../../lib/semantic-recovery-proof";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function SemanticRecoveryProofPage({
  params,
}: {
  params: Promise<{ automationId: string; runId: string }>;
}) {
  const { automationId, runId } = await params;
  let run;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    run = await client.run(automationId, runId);
  } catch (error) {
    const returnTo = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/semantic-recovery-proof`;
    if (error instanceof WebAuthError) {
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect semantic recovery proof.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></section>;
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return <section className="card stack"><div className="eyebrow">Not configured</div><h1>Recovery proof is unavailable.</h1><p>The UI does not fabricate execution state when its authenticated control plane is unavailable.</p></section>;
    }
    return <section className="card stack"><h1>Recovery proof unavailable</h1><p>The request failed safely. Provider, browser, page, and credential details remain hidden.</p></section>;
  }

  const proof = semanticRecoveryProof(run.status, run.reasoning ?? []);
  const diagnosticsHref = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`;

  return (
    <section className="card stack">
      <div className="eyebrow">Semantic recovery proof</div>
      <h1>{proof.kind === "VERIFIED" ? "Verified recovery" : proof.kind === "OBSERVED" ? "Recovery observed" : "No recovery recorded"}</h1>
      {proof.kind === "VERIFIED" ? (
        <>
          <p>The durable run succeeded after {proof.recoveryCount} constrained semantic recovery decision{proof.recoveryCount === 1 ? "" : "s"}. Terminal success means the ordinary execution path also accepted the required post-effect verification before completion.</p>
          <div className="row"><span>Run status</span><strong>{run.status}</strong></div>
          <div className="row"><span>Semantic recoveries</span><strong>{proof.recoveryCount}</strong></div>
        </>
      ) : proof.kind === "OBSERVED" ? (
        <>
          <p>{proof.recoveryCount} constrained semantic recovery decision{proof.recoveryCount === 1 ? " was" : "s were"} recorded, but this run has not reached durable success. This page does not claim that the recovered effect was verified.</p>
          <div className="row"><span>Run status</span><strong>{run.status}</strong></div>
          <div className="row"><span>Semantic recoveries</span><strong>{proof.recoveryCount}</strong></div>
        </>
      ) : (
        <p>No semantic recovery summary is recorded for this run. Deterministic execution may have been sufficient.</p>
      )}
      <p className="muted">This is a presentation-only proof derived from durable run status and sanitized reasoning summaries. It exposes no selectors, page observations, runtime inputs, model rationale, credentials, Browser Profile identifiers, or hidden chain-of-thought, and it grants no execution authority.</p>
      <Link href={diagnosticsHref}>Back to full run diagnostics</Link>
    </section>
  );
}
