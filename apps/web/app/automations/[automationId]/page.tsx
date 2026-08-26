import { AUTOMATION_DRAFT_LIMITS, canUpdateAutomationObjective } from "@automation/core";
import Link from "next/link";
import { loadAutomationDetail } from "../../../lib/automation-detail-load";
import { captureLaunchPresentation } from "../../../lib/capture-command-state";
import { compileCapturePresentation } from "../../../lib/compile-readiness";
import { WebControlPlaneError } from "../../../lib/control-plane-client";
import { shouldPollCaptureReadiness } from "../../../lib/capture-readiness";
import { freshTestCredentialReadiness } from "../../../lib/fresh-test-credential-readiness";
import { shouldPollFreshTest } from "../../../lib/fresh-test-readiness";
import { freshTestStructuredInputFields } from "../../../lib/fresh-test-input-form";
import { serverResolvedPublishWorkflowVersion } from "../../../lib/product-flow-identities";
import { scheduledStructuredInputFields } from "../../../lib/scheduled-input-form";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../lib/server-auth";
import { automationPhase, formatSchedule, latestFreshTestFeedback, runHistoryStatusDetail, runKindLabel, runTone } from "../../../lib/view-model";
import { CaptureReadinessPoller } from "./capture-readiness-poller";
import { FreshTestReadinessPoller } from "./fresh-test-readiness-poller";
import { WorkflowInspectionCard } from "./workflow-inspection-card";

export const dynamic = "force-dynamic";
const notices: Record<string, string> = {
  created: "Draft created. Start capture when the capture capability is configured.",
  "recording-started": "Workflow recording started. Demonstrate only the actions you want the automation to replay.",
  "capture-finishing": "Finish requested. The capture worker will save the browser profile and trace before compilation becomes ready.",
  "capture-canceled": "Capture canceled. Its partial workflow was discarded and you can start a new cloud capture now.",
  "objective-updated": "Objective updated. Capture and Fresh Test the revised goal before publishing it.",
  compiled: "Capture compiled into a workflow version. Review the semantic plan before running a fresh test.",
  tested: "Fresh test accepted. Cloud execution continues independently; this page tracks the durable result automatically.",
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
  let captureRecording;
  let workflowInspection;
  let runHistoryUnavailable = false;
  let authenticatedClient: Awaited<ReturnType<typeof createAuthenticatedWebControlPlaneClient>> | null = null;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    authenticatedClient = client;
    const detail = await loadAutomationDetail(client, automationId);
    ({ automation, runs, captureRecording, workflowInspection, runHistoryUnavailable } = detail);
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
  const captureLaunch = captureLaunchPresentation(automation.status, captureRecording);
  const objectiveEditable = canUpdateAutomationObjective(automation.status) && captureRecording.kind === "NONE";
  const compilePresentation = compileCapturePresentation(automation);
  const publishWorkflowVersion = serverResolvedPublishWorkflowVersion(automation, runs);
  const freshTestFeedback = latestFreshTestFeedback(runs);
  const pollFreshTest = !runHistoryUnavailable && shouldPollFreshTest({
    submissionAccepted: notice === "tested",
    feedbackKind: freshTestFeedback.kind,
  });
  const freshTestInputFields = workflowInspection ? freshTestStructuredInputFields(workflowInspection.runtimeInputs) : null;
  const freshTestCandidate = !runHistoryUnavailable
    && (automation.status === "READY_TO_TEST" || automation.status === "READY_TO_PUBLISH")
    && !pollFreshTest
    && freshTestInputFields !== null;
  let credentialReadiness = freshTestCredentialReadiness(null);
  if (freshTestCandidate && authenticatedClient) {
    try {
      credentialReadiness = freshTestCredentialReadiness(await authenticatedClient.credentials());
    } catch {
      // Keep the page available on a summary-read outage. The POST mutation and execution plane
      // still perform the authoritative credential checks before cloud execution.
    }
  }
  const freshTestReady = freshTestCandidate && credentialReadiness.kind !== "NEEDS_CREDENTIAL";
  const scheduledInputFields = workflowInspection ? scheduledStructuredInputFields(workflowInspection.runtimeInputs) : null;
  const publishReady = publishWorkflowVersion !== null && scheduledInputFields !== null;

  return <>
    {notice && notices[notice] ? <div className="notice">{notices[notice]}</div> : null}
    {runHistoryUnavailable ? <div className="notice">Run history is temporarily unavailable. Capture and workflow inspection remain available, but Fresh Test provenance and publishing are paused until durable history can be read again.</div> : null}
    <section className="hero"><div><div className="eyebrow">{automationPhase(automation)}</div><h1>{automation.name}</h1><p>{automation.objective}</p><p className="muted">{automation.websiteUrl}</p></div><div className="card subtle stack"><div className="row"><span>Status</span><span className={automation.needsAttention ? "badge warning" : "badge"}>{automation.status}</span></div><div className="row"><span>Workflow version</span><strong>{automation.publishedWorkflowVersion ?? "Not published"}</strong></div><div className="row"><span>Schedule</span><span className="muted">{formatSchedule(automation)}</span></div></div></section>
    <section className="card stack" style={{ marginBottom: 18 }}><div><div className="eyebrow">Goal</div><h2>Automation objective</h2><p className="muted">Change what this automation should accomplish. A changed objective must be captured and Fresh-Tested again before it can be published.</p></div>{objectiveEditable ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/objective`} method="post"><label>Objective<textarea name="objective" defaultValue={automation.objective} maxLength={AUTOMATION_DRAFT_LIMITS.objective} required /></label><button className="button secondary" type="submit">Update objective &amp; reteach</button></form> : captureRecording.kind === "ACTIVE" ? <p className="muted">Finish or cancel the active capture before changing its objective.</p> : automation.status === "ACTIVE" || automation.status === "PAUSED" ? <p className="muted">Disable the published automation before changing its objective. This keeps future scheduled execution fenced while the replacement workflow is taught and tested.</p> : <p className="muted">Resolve the current execution or attention state before changing the automation objective.</p>}</section>
    <section className="grid two">
      <div className="card stack"><h2>Teach and verify</h2>
        <div className="step" id="capture-workflow"><div className="step-number">1</div><div><h3>Capture workflow</h3><p>Open the isolated cloud browser. Sign in yourself; authentication setup is excluded from scheduled replay. Keep Live View open in its separate tab while you control recording here.</p>{captureLaunch.kind === "START" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/capture`} method="post"><button className="button" type="submit">Open cloud capture</button></form> : null}{captureRecording.kind === "ACTIVE" ? <div className="stack" style={{ marginTop: 12 }}><div className="row"><span>Capture phase</span><span className="badge">{captureRecording.finishRequested ? "FINISHING" : captureRecording.phase}</span></div><p className="muted">Session expires {captureRecording.expiresAt}. Capture, Browser Profile, and provider identifiers remain server-side.</p>{captureRecording.phase === "AUTH_SETUP" ? <><p>Finish signing in inside Live View, then start recording. Login steps will not become scheduled actions.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/record-workflow`} method="post"><button className="button secondary" type="submit">Start recording workflow</button></form></> : captureRecording.finishRequested ? <><p>Finish has been requested. The trusted capture worker is saving the Browser Profile and trace.</p><CaptureReadinessPoller enabled={pollCaptureReadiness} /></> : <><p>Workflow recording is active. Demonstrate the reusable workflow, then request finish.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/finish-capture`} method="post"><button className="button secondary" type="submit">Finish capture</button></form></>}{!captureRecording.finishRequested ? <div className="stack"><p className="muted">Lost or closed the Live View tab? Cancel this partial capture to release the durable capture slot, then start over. Partial session changes are not saved as an approved capture.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/cancel-capture`} method="post"><button className="button secondary" type="submit">Cancel capture &amp; start over</button></form></div> : null}<Link href={`/automations/${encodeURIComponent(automationId)}`}>Refresh capture state</Link></div> : <p className="muted">{captureLaunch.message}</p>}</div></div>
        <div className="step"><div className="step-number">2</div><div><h3>Compile and inspect workflow</h3>{compilePresentation.kind === "READY" ? <><p>The latest trusted cloud capture completed at {compilePresentation.completedAt}. Compile always uses that server-resolved capture; no trace or workflow identifier is supplied by the browser.</p><form action={`/api/ui/automations/${encodeURIComponent(automationId)}/compile`} method="post"><button className="button secondary" type="submit">Compile latest capture</button></form></> : <p>{compilePresentation.message}</p>}{workflowInspection ? <WorkflowInspectionCard workflow={workflowInspection} /> : <p className="muted">No compiled workflow is available yet. After compilation, a sanitized semantic step plan appears here before fresh testing.</p>}</div></div>
        <div className="step"><div className="step-number">3</div><div><h3>Fresh test</h3><p>Run the compiled workflow from a fresh execution boundary before publication. The server creates a unique test-run identity automatically.</p>{freshTestFeedback.kind !== "NONE" ? <div className="card subtle stack"><div className="row"><strong>Latest fresh test</strong><span className={`badge ${runTone(freshTestFeedback.run.status)}`}>{freshTestFeedback.run.status}</span></div><p className="muted">Workflow v{freshTestFeedback.run.workflowVersion} · {freshTestFeedback.run.scheduledAt}</p>{freshTestFeedback.kind === "PASSED" ? <p>The latest fresh execution passed verification and can be approved while it remains the latest compiled version.</p> : null}{freshTestFeedback.kind === "RUNNING" ? <p>The fresh execution is still in progress. This page follows its durable run state automatically; diagnostics remain available at any time.</p> : null}{freshTestFeedback.kind === "NEEDS_ATTENTION" ? <p>The test paused safely for human attention. Resolve that run before deciding whether the workflow itself needs correction.</p> : null}{freshTestFeedback.kind === "NEEDS_CORRECTION" ? <><p>The fresh test did not complete successfully. Inspect the failed step, then record a corrected workflow, compile the new immutable version, and test again.</p><Link href="#capture-workflow">Record corrected workflow</Link></> : null}<Link href={`/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(freshTestFeedback.run.runId)}`}>Open fresh-test diagnostics</Link></div> : null}<FreshTestReadinessPoller enabled={pollFreshTest} />{runHistoryUnavailable ? <p className="muted">Run history is temporarily unavailable, so Fresh Test submission is paused until the product can verify durable run provenance again.</p> : freshTestReady && freshTestInputFields ? <div className="stack"><p className="muted">Fresh Test uses guided per-step values. Internal workflow-variable names stay server-side.</p><Link className="button secondary" href={`/automations/${encodeURIComponent(automationId)}/fresh-test`}>Provide values &amp; run Fresh Test</Link></div> : freshTestCandidate && credentialReadiness.kind === "NEEDS_CREDENTIAL" ? <div className="stack"><p className="muted">Fresh Test needs a usable OpenAI BYOK credential. Configure or repair the primary OpenAI key before starting cloud browser/model execution.</p><Link className="button secondary" href="/settings/credentials">Configure OpenAI credential</Link></div> : pollFreshTest ? <p className="muted">A fresh test is already active. Wait for its durable result before starting another intentional test.</p> : workflowInspection && freshTestInputFields === null ? <p className="muted">The compiled workflow input requirements are invalid. Recompile the capture before testing.</p> : <p className="muted">Compile a capture before starting a fresh test.</p>}</div></div>
      </div>
      <div className="card stack"><h2>Approve and publish</h2><p>Publishing remains gated by the control plane: only the latest successfully tested immutable workflow version can be activated.</p>
        {runHistoryUnavailable ? <p className="muted">Publishing is temporarily paused because successful Fresh Test provenance cannot be verified while run history is unavailable.</p> : publishReady ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/publish`} method="post"><label>Recurrence<select name="kind" defaultValue="DAILY"><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="CRON">Custom cron</option></select></label><label>Schedule expression<input name="expression" defaultValue="09:00" required /></label><label>Timezone<input name="timezone" defaultValue="Asia/Kolkata" required /></label>{scheduledInputFields.length > 0 ? <div className="stack"><p><strong>Reusable scheduled values</strong></p><p className="muted">Capture hides typed and selected values by design. Provide one reusable value for each semantic workflow step below. Internal workflow-variable names remain server-side. Do not enter passwords, OTPs, API keys, tokens, or other secrets; target-site authentication belongs in the Browser Profile.</p>{scheduledInputFields.map((field, index) => { const requirement = workflowInspection!.runtimeInputs[index]!; return <label key={field.name}>Step {requirement.step} reusable scheduled value<input name={field.name} type="text" maxLength={4_096} autoComplete="off" aria-label={`Step ${requirement.step} reusable scheduled value`} required /></label>; })}<label><input type="checkbox" name="scheduledInputsAreNonSecret" value="yes" required /> I confirm every value above is non-secret and safe to persist for future scheduled runs.</label></div> : <p className="muted">This workflow has no unresolved captured values, so no reusable scheduled inputs are required.</p>}<button className="button" type="submit">Approve and publish</button></form> : publishWorkflowVersion !== null && scheduledInputFields === null ? <p className="muted">Publishing is paused because the compiled workflow input requirements are invalid. Recompile the trusted capture rather than guessing at workflow variables.</p> : <p className="muted">Complete a successful fresh test before publishing. The tested workflow version is resolved from trusted run state rather than entered by the user.</p>}
        <p className="muted">The server resolves the tested workflow version, reloads trusted workflow input requirements, validates the IANA timezone, and cannot accept tenant/user ownership from this form.</p>
      </div>
    </section>
    {automation.schedule && automation.publishedWorkflowVersion !== undefined ? <section className="card stack" style={{ marginTop: 18 }}><div><div className="eyebrow">Published automation</div><h2>Manage schedule</h2><p className="muted">Change recurrence without republishing the workflow, or stop future cloud runs while preserving workflow versions, Browser Profile state, and history.</p></div>{automation.status === "ACTIVE" || automation.status === "PAUSED" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/schedule`} method="post"><label>Recurrence<select name="kind" defaultValue={automation.schedule.kind}><option value="HOURLY">Hourly</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="CRON">Custom cron</option></select></label><label>Schedule expression<input name="expression" defaultValue={automation.schedule.expression} required /></label><label>Timezone<input name="timezone" defaultValue={automation.schedule.timezone} required /></label><button className="button secondary" type="submit">Update schedule</button></form> : null}<div className="row">{automation.status === "ACTIVE" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/pause`} method="post"><button className="button secondary" type="submit">Pause automation</button></form> : null}{automation.status === "PAUSED" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/resume`} method="post"><button className="button" type="submit">Resume automation</button></form> : null}{automation.status === "ACTIVE" || automation.status === "PAUSED" ? <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/disable`} method="post"><button className="button secondary" type="submit">Disable automation</button></form> : null}</div>{automation.status === "DISABLED" ? <p className="muted">This automation is disabled. Its published workflow and history remain available for inspection.</p> : <p className="muted">Pause is reversible. Disable stops future scheduling while retaining the durable automation record.</p>}</section> : null}
    <section className="card stack" style={{ marginTop: 18 }}><div className="row"><div><h2>Run history</h2><p className="muted">Execution state only; no cookies, browser profiles, provider keys, internal node identifiers, or hidden model chain-of-thought. Open a run for semantic step diagnostics.</p></div></div>{runHistoryUnavailable ? <p className="muted">Run history is temporarily unavailable. Existing runs have not been deleted; retry this page after the storage path recovers.</p> : runs.length === 0 ? <p className="muted">No runs yet.</p> : <div className="list">{runs.map((run) => <div className="list-item" key={run.runId}><div><h3><Link href={`/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(run.runId)}`}>{runKindLabel(run)} · Workflow v{run.workflowVersion}</Link></h3><div className="muted">{run.scheduledAt}</div></div><div><span className={`badge ${runTone(run.status)}`}>{run.status}</span></div><div className="muted">{runHistoryStatusDetail(run)}</div></div>)}</div>}</section>
  </>;
}
