import Link from "next/link";
import { WebControlPlaneError } from "../../../../../lib/control-plane-client";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../lib/server-auth";
import { runTone } from "../../../../../lib/view-model";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
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
    if (error instanceof WebAuthError) {
      const returnTo = `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`;
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect this run.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></section>;
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return <section className="card stack"><div className="eyebrow">Not configured</div><h1>Run diagnostics are unavailable.</h1><p>The UI does not fabricate execution state when its authenticated control plane is unavailable.</p><Link className="button" href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link></section>;
    }
    return <section className="card stack"><h1>Run unavailable</h1><p>The request failed safely. Provider, browser, and credential error text is intentionally hidden.</p><Link className="button" href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link></section>;
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Run diagnostics</div>
          <h1>{run.runId}</h1>
          <p className="muted">Workflow version {run.workflowVersion} · scheduled {run.scheduledAt}</p>
          <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link>
        </div>
        <div className="card subtle stack">
          <div className="row"><span>Status</span><span className={`badge ${runTone(run.status)}`}>{run.status}</span></div>
          <div className="row"><span>Current node</span><strong>{run.currentNodeId ?? run.checkpoint?.currentNodeId ?? "—"}</strong></div>
          <div className="row"><span>Started</span><span className="muted">{run.startedAt ?? "—"}</span></div>
          <div className="row"><span>Finished</span><span className="muted">{run.finishedAt ?? "—"}</span></div>
        </div>
      </section>

      {run.needsHumanAttention ? (
        <section className="card stack" style={{ marginBottom: 18 }}>
          <div className="eyebrow">Human attention required</div>
          <h2>This run is safely paused.</h2>
          <p>The platform will not automatically replay the blocked action. Inspect the failure and checkpoint below before using the human takeover/resume flow.</p>
          <p className="muted">The current deployment exposes diagnostic state here; action-capable recovery remains isolated from this read-only page.</p>
        </section>
      ) : null}

      <section className="grid two">
        <div className="card stack">
          <h2>Failure</h2>
          {run.failure ? (
            <>
              <div className="row"><span>Code</span><strong>{run.failure.code}</strong></div>
              <div className="row"><span>Retryable</span><span>{run.failure.retryable ? "Yes" : "No"}</span></div>
              <div className="row"><span>Node</span><span>{run.failure.nodeId ?? "—"}</span></div>
              <div><h3>Evidence references</h3>{run.failure.evidenceRefs.length === 0 ? <p className="muted">None recorded.</p> : <ul>{run.failure.evidenceRefs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul>}</div>
            </>
          ) : <p className="muted">No terminal or attention failure is recorded on the run.</p>}
        </div>

        <div className="card stack">
          <h2>Checkpoint</h2>
          {run.checkpoint ? (
            <>
              <div className="row"><span>Current node</span><strong>{run.checkpoint.currentNodeId}</strong></div>
              <div className="row"><span>Attempt</span><span>{run.checkpoint.attempt}</span></div>
              <div className="row"><span>Repeated state count</span><span>{run.checkpoint.fingerprintRepeatCount}</span></div>
              <div className="row"><span>Updated</span><span className="muted">{run.checkpoint.updatedAt}</span></div>
              <div><h3>Completed nodes</h3>{run.checkpoint.completedNodeIds.length === 0 ? <p className="muted">None yet.</p> : <ul>{run.checkpoint.completedNodeIds.map((nodeId) => <li key={nodeId}><code>{nodeId}</code></li>)}</ul>}</div>
              {run.checkpoint.lastFailure ? <div><h3>Last checkpoint failure</h3><p><strong>{run.checkpoint.lastFailure.code}</strong>{run.checkpoint.lastFailure.nodeId ? ` at ${run.checkpoint.lastFailure.nodeId}` : ""}</p></div> : null}
              <div><h3>Checkpoint evidence</h3>{run.checkpoint.evidenceRefs.length === 0 ? <p className="muted">None recorded.</p> : <ul>{run.checkpoint.evidenceRefs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul>}</div>
            </>
          ) : <p className="muted">No checkpoint has been persisted for this run.</p>}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <p className="muted">This view intentionally excludes runtime variables, raw provider/browser error messages, page fingerprints, cookies, Browser Profile data, BYOK secrets, workload tokens, evidence contents, and model chain-of-thought.</p>
      </section>
    </>
  );
}
