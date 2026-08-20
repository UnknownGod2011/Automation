import Link from "next/link";
import { WebControlPlaneError } from "../../../lib/control-plane-client";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../lib/server-auth";
import { automationPhase, formatSchedule, runTone } from "../../../lib/view-model";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  created: "Draft created. Start capture when the capture capability is configured.",
  compiled: "Capture compiled into a workflow version.",
  tested: "Fresh test request completed.",
  published: "Workflow published with the requested schedule.",
  "not-configured": "This deployment is not configured for that operation.",
  "request-failed": "The operation failed safely. Provider/internal details were not exposed.",
  "invalid-input": "The submitted values were invalid.",
};

export default async function AutomationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ automationId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { automationId } = await params;
  const { notice } = await searchParams;
  let automation;
  let runs;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    [automation, runs] = await Promise.all([client.automation(automationId), client.runs(automationId)]);
  } catch (error) {
    if (error instanceof WebAuthError) {
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect this automation.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}`)}`}>Sign in</Link></section>;
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return <section className="card"><div className="eyebrow">Not configured</div><h1>Connect the control plane to inspect this automation.</h1><p>The browser UI does not fabricate automation data when its authenticated API boundary is unavailable.</p><Link className="button" href="/">Back to dashboard</Link></section>;
    }
    return <section className="card"><h1>Automation unavailable</h1><p>The control-plane request failed. Sensitive upstream error text is intentionally hidden.</p><Link className="button" href="/">Back to dashboard</Link></section>;
  }

  return (
    <>
      {notice && notices[notice] ? <div className="notice">{notices[notice]}</div> : null}
      <section className="hero">
        <div><div className="eyebrow">{automationPhase(automation)}</div><h1>{automation.name}</h1><p>{automation.objective}</p><p className="muted">{automation.websiteUrl}</p></div>
        <div className="card subtle stack"><div className="row"><span>Status</span><span className={automation.needsAttention ? "badge warning" : "badge"}>{automation.status}</span></div><div className="row"><span>Workflow version</span><strong>{automation.publishedWorkflowVersion ?? "Not published"}</strong></div><div className="row"><span>Schedule</span><span className="muted">{formatSchedule(automation)}</span></div></div>
      </section>

      <section className="grid two">
        <div className="card stack">
          <h2>Teach and verify</h2>
          <div className="step"><div className="step-number">1</div><div><h3>Capture workflow</h3><p>Open the isolated cloud browser. Sign in yourself; authentication setup is excluded from scheduled replay.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/capture`} method="post"><button className="button" type="submit">Start cloud capture</button></form></div></div>
          <div className="step"><div className="step-number">2</div><div><h3>Compile captured workflow</h3>{automation.latestCompletedCapture ? <><p>The latest trusted cloud capture completed at {automation.latestCompletedCapture.completedAt}. It is ready to compile; no server trace ID needs to be copied manually.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/compile`} method="post"><input type="hidden" name="traceId" value={automation.latestCompletedCapture.traceId} /><label>Workflow ID<input name="workflowId" defaultValue={`workflow-${automationId}`} required /></label><button className="button secondary" type="submit">Compile latest capture</button></form></> : <p>Finish a cloud capture first. Once the trusted capture worker saves the Browser Profile and trace, this step becomes ready automatically.</p>}</div></div>
          <div className="step"><div className="step-number">3</div><div><h3>Fresh test</h3><p>Run the compiled workflow from a fresh execution boundary before publication.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/test`} method="post"><label>Run ID<input name="runId" defaultValue={`test-${automationId}`} required /></label><label>Runtime variables (JSON, optional)<textarea name="runtimeVariables" placeholder={'{"customer":"Acme"}'} /></label><button className="button secondary" type="submit">Run fresh test</button></form></div></div>
        </div>

        <div className="card stack">
          <h2>Approve and publish</h2><p>Publishing remains gated by the control plane: only the latest successfully tested immutable workflow version can be activated.</p>
          <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/publish`} method="post"><label>Workflow version<input name="workflowVersion" type="number" min="1" defaultValue={automation.publishedWorkflowVersion ?? 1} required /></label><label>Recurrence<select name="kind" defaultValue="DAILY"><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="CRON">Custom cron</option></select></label><label>Schedule expression<input name="expression" defaultValue="09:00" required /></label><label>Timezone<input name="timezone" defaultValue="Asia/Kolkata" required /></label><button className="button" type="submit">Approve and publish</button></form>
          <p className="muted">The server validates the IANA timezone and tested workflow version; this form cannot override tenant/user ownership.</p>
        </div>
      </section>

      <section className="card stack" style={{ marginTop: 18 }}>
        <div className="row"><div><h2>Run history</h2><p className="muted">Execution state only; no cookies, browser profiles, provider keys, or hidden model chain-of-thought.</p></div></div>
        {runs.length === 0 ? <p className="muted">No runs yet.</p> : <div className="list">{runs.map((run) => <div className="list-item" key={run.runId}><div><h3>{run.runId}</h3><div className="muted">Scheduled {run.scheduledAt}</div></div><div><span className={`badge ${runTone(run.status)}`}>{run.status}</span></div><div className="muted">{run.failureCode ? `Failure: ${run.failureCode}` : run.currentNodeId ? `Node: ${run.currentNodeId}` : "—"}</div></div>)}</div>}
      </section>
    </>
  );
}
