import type { CaptureRecordingView } from "@automation/core";
import Link from "next/link";
import { WebControlPlaneError } from "../../../lib/control-plane-client";
import { shouldPollCaptureReadiness } from "../../../lib/capture-readiness";
import { serverResolvedPublishWorkflowVersion } from "../../../lib/product-flow-identities";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../lib/server-auth";
import { automationPhase, formatSchedule, runTone } from "../../../lib/view-model";
import { CaptureReadinessPoller } from "./capture-readiness-poller";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  created: "Draft created. Start capture when the capture capability is configured.",
  "recording-started": "Workflow recording started. Demonstrate only the actions you want the automation to replay.",
  "capture-finishing": "Finish requested. The capture worker will save the browser profile and trace before compilation becomes ready.",
  compiled: "Capture compiled into a workflow version.",
  tested: "Fresh test request completed. The generated run appears in run history below.",
  published: "Workflow published with the requested schedule.",
  "schedule-updated": "Schedule updated without changing the published workflow version.",
  paused: "Automation paused. Future scheduled deliveries cannot start browser execution while it remains paused.",
  resumed: "Automation resumed and its schedule is enabled.",
  disabled: "Automation disabled. Workflow versions, browser profile state, and run history were preserved.",
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
  let captureRecording: CaptureRecordingView = { kind: "NONE" };
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    [automation, runs, captureRecording] = await Promise.all([
      client.automation(automationId),
      client.runs(automationId),
      client.captureRecording(automationId),
    ]);
  } catch (error) {
    if (error instanceof WebAuthError) {
      return <section className="card stack"><div className="eyebrow">Sign in required</div><h1>Authenticate to inspect this automation.</h1><Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}`)}`}>Sign in</Link></section>;
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return <section className="card"><div className="eyebrow">Not configured</div><h1>Connect the control plane to inspect this automation.</h1><p>The browser UI does not fabricate automation data when its authenticated API boundary is unavailable.</p><Link className="button" href="/">Back to dashboard</Link></section>;
    }
    return <section className="card"><h1>Automation unavailable</h1><p>The control-plane request failed. Sensitive upstream error text is intentionally hidden.</p><Link className="button" href="/">Back to dashboard</Link></section>;
  }

  const pollCaptureReadiness = captureRecording.kind === "ACTIVE" && shouldPollCaptureReadiness({
    finishRequested: captureRecording.finishRequested,
    hasLatestCapture: automation.latestCompletedCapture !== undefined,
  });
  const publishWorkflowVersion = serverResolvedPublishWorkflowVersion(automation, runs);

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
          <div className="step"><div className="step-number">1</div><div><h3>Capture workflow</h3><p>Open the isolated cloud browser. Sign in yourself; authentication setup is excluded from scheduled replay. Use your browser Back button to return here after authentication.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/capture`} method="post"><button className="button" type="submit">Open cloud capture</button></form>{captureRecording.kind === "ACTIVE" ? <div className="stack" style={{ marginTop: 12 }}><div className="row"><span>Capture phase</span><span className="badge">{captureRecording.finishRequested ? "FINISHING" : captureRecording.phase}</span></div><p className="muted">Session expires {captureRecording.expiresAt}. Browser/Profile identifiers remain server-side.</p>{captureRecording.phase === "AUTH_SETUP" ? <><p>Finish signing in inside Live View, then start recording. Login steps will not become scheduled actions.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/record-workflow`} method="post"><input type="hidden" name="captureSessionId" value={captureRecording.captureSessionId} /><button className="button secondary" type="submit">Start recording workflow</button></form></> : captureRecording.finishRequested ? <><p>Finish has been requested. The trusted capture worker is saving the Browser Profile and trace.</p><CaptureReadinessPoller enabled={pollCaptureReadiness} /></> : <><p>Workflow recording is active. Demonstrate the reusable workflow, then request finish.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/finish-capture`} method="post"><input type="hidden" name="captureSessionId" value={captureRecording.captureSessionId} /><button className="button secondary" type="submit">Finish capture</button></form></>}<Link href={`/automations/${encodeURIComponent(automationId)}`}>Refresh capture state</Link></div> : <p className="muted">No active capture session. Starting a cloud capture creates durable recording-control state.</p>}</div></div>
          <div className="step"><div className="step-number">2</div><div><h3>Compile captured workflow</h3>{automation.latestCompletedCapture ? <><p>The latest trusted cloud capture completed at {automation.latestCompletedCapture.completedAt}. Compile always uses that server-resolved capture; no trace or workflow identifier is supplied by the browser.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/compile`} method="post"><button className="button secondary" type="submit">Compile latest capture</button></form></> : <p>Finish a cloud capture first. Once the trusted capture worker saves the Browser Profile and trace, this step becomes ready automatically.</p>}</div></div>
          <div className="step"><div className="step-number">3</div><div><h3>Fresh test</h3><p>Run the compiled workflow from a fresh execution boundary before publication. The server creates a unique test-run identity automatically.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/test`} method="post"><label>Runtime variables (JSON, optional)<textarea name="runtimeVariables" placeholder={'{"customer":"Acme"}'} /></label><button className="button secondary" type="submit">Run fresh test</button></form></div></div>
        </div>

        <div className="card stack">
          <h2>Approve and publish</h2><p>Publishing remains gated by the control plane: only the latest successfully tested immutable workflow version can be activated.</p>
          {publishWorkflowVersion !== null ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/publish`} method="post"><label>Recurrence<select name="kind" defaultValue="DAILY"><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="CRON">Custom cron</option></select></label><label>Schedule expression<input name="expression" defaultValue="09:00" required /></label><label>Timezone<input name="timezone" defaultValue="Asia/Kolkata" required /></label><button className="button" type="submit">Approve and publish</button></form> : <p className="muted">Complete a successful fresh test before publishing. The tested workflow version is resolved from trusted run state rather than entered by the user.</p>}
          <p className="muted">The server resolves the tested workflow version, validates the IANA timezone, and cannot accept tenant/user ownership from this form.</p>
        </div>
      </section>

      {automation.schedule && automation.publishedWorkflowVersion !== undefined ? (
        <section className="card stack" style={{ marginTop: 18 }}>
          <div><div className="eyebrow">Published automation</div><h2>Manage schedule</h2><p className="muted">Change recurrence without republishing the workflow, or stop future cloud runs while preserving workflow versions, Browser Profile state, and history.</p></div>
          {automation.status === "ACTIVE" || automation.status === "PAUSED" ? (
            <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/schedule`} method="post">
              <label>Recurrence<select name="kind" defaultValue={automation.schedule.kind}><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="CRON">Custom cron</option></select></label>
              <label>Schedule expression<input name="expression" defaultValue={automation.schedule.expression} required /></label>
              <label>Timezone<input name="timezone" defaultValue={automation.schedule.timezone} required /></label>
              <button className="button secondary" type="submit">Update schedule</button>
            </form>
          ) : null}
          <div className="row">
            {automation.status === "ACTIVE" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/pause`} method="post"><button className="button secondary" type="submit">Pause automation</button></form> : null}
            {automation.status === "PAUSED" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/resume`} method="post"><button className="button" type="submit">Resume automation</button></form> : null}
            {automation.status === "ACTIVE" || automation.status === "PAUSED" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/disable`} method="post"><button className="button secondary" type="submit">Disable automation</button></form> : null}
          </div>
          {automation.status === "DISABLED" ? <p className="muted">This automation is disabled. Its published workflow and history remain available for inspection.</p> : <p className="muted">Pause is reversible. Disable stops future scheduling while retaining the durable automation record.</p>}
        </section>
      ) : null}

      <section className="card stack" style={{ marginTop: 18 }}>
        <div className="row"><div><h2>Run history</h2><p className="muted">Execution state only; no cookies, browser profiles, provider keys, or hidden model chain-of-thought. Select a run for sanitized checkpoint diagnostics.</p></div></div>
        {runs.length === 0 ? <p className="muted">No runs yet.</p> : <div className="list">{runs.map((run) => <div className="list-item" key={run.runId}><div><h3><Link href={`/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(run.runId)}`}>{run.runId}</Link></h3><div className="muted">Scheduled {run.scheduledAt}</div></div><div><span className={`badge ${runTone(run.status)}`}>{run.status}</span></div><div className="muted">{run.failureCode ? `Failure: ${run.failureCode}` : run.currentNodeId ? `Node: ${run.currentNodeId}` : "—"}</div></div>)}</div>}
      </section>
    </>
  );
}
