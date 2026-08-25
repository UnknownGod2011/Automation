import Link from "next/link";
import type { RunSemanticStepView } from "@automation/core";
import { WebControlPlaneError } from "../../../../../lib/control-plane-client";
import { shouldPollRunStatus } from "../../../../../lib/run-status-readiness";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../../lib/server-auth";
import { runTone } from "../../../../../lib/view-model";
import { RunStatusPoller } from "./run-status-poller";

export const dynamic = "force-dynamic";

const MAX_EVIDENCE_LINKS = 20;

function stepHeading(step: RunSemanticStepView | undefined): string {
  return step ? `Step ${step.step} · ${step.kind}` : "Step unavailable";
}

function evidenceSummary(count: number): string {
  return count === 0 ? "No evidence recorded." : `${count} protected evidence item${count === 1 ? "" : "s"} recorded.`;
}

function evidenceLinks(automationId: string, runId: string, count: number) {
  if (count <= 0) return null;
  const visibleCount = Math.min(count, MAX_EVIDENCE_LINKS);
  return (
    <>
      <ul>
        {Array.from({ length: visibleCount }, (_, index) => {
          const ordinal = index + 1;
          return (
            <li key={ordinal}>
              <Link href={`/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/evidence/${ordinal}`}>
                View evidence item {ordinal}
              </Link>
            </li>
          );
        })}
      </ul>
      {count > visibleCount ? <p className="muted">Showing the first {visibleCount} of {count} evidence items.</p> : null}
    </>
  );
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ automationId: string; runId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { automationId, runId } = await params;
  const { notice } = await searchParams;
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

  const currentStep = run.semantic?.current;
  const failureStep = run.semantic?.failure;
  const completedSteps = run.semantic?.completed ?? [];
  const pollRunStatus = shouldPollRunStatus({ status: run.status, ...(notice ? { notice } : {}) });

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Run diagnostics</div>
          <h1>Execution details</h1>
          <p className="muted">Workflow version {run.workflowVersion} · scheduled {run.scheduledAt}</p>
          <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link>
        </div>
        <div className="card subtle stack">
          <div className="row"><span>Status</span><span className={`badge ${runTone(run.status)}`}>{run.status}</span></div>
          <div className="row"><span>Current step</span><strong>{stepHeading(currentStep)}</strong></div>
          {currentStep ? <p>{currentStep.objective}</p> : <p className="muted">Semantic workflow metadata is temporarily unavailable; durable run state remains intact.</p>}
          <div className="row"><span>Started</span><span className="muted">{run.startedAt ?? "—"}</span></div>
          <div className="row"><span>Finished</span><span className="muted">{run.finishedAt ?? "—"}</span></div>
        </div>
      </section>

      {notice === "resume-submitted" ? <section className="card" style={{ marginBottom: 18 }}><p>Resume command submitted. This page will follow the latest durable run state automatically.</p></section> : null}
      {notice === "resume-failed" ? <section className="card" style={{ marginBottom: 18 }}><p>The resume command was not accepted. The run remains protected by its durable pause boundary.</p></section> : null}
      {notice === "takeover-finished" ? <section className="card" style={{ marginBottom: 18 }}><p>The repaired browser profile was saved and the durable resume command was submitted. This page will follow the resumed run automatically.</p></section> : null}
      {notice === "takeover-failed" ? <section className="card" style={{ marginBottom: 18 }}><p>The repair session could not be completed. The run remains safely paused.</p></section> : null}
      <RunStatusPoller enabled={pollRunStatus} />

      {run.needsHumanAttention ? (
        <section className="card stack" style={{ marginBottom: 18 }}>
          <div className="eyebrow">Human attention required</div>
          <h2>This run is safely paused.</h2>
          <p>The platform will not automatically replay the blocked action. Inspect the semantic step and failure below before continuing.</p>
          {run.humanResumeEligible ? (
            <>
              <p>This is an explicit workflow human step with exactly one declared successor. After completing or approving the requested manual step, continue the same durable run.</p>
              <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/resume`} method="post">
                <button className="button" type="submit">Continue workflow</button>
              </form>
              <p className="muted">The browser does not choose the paused node, branch, claim ID, or execution credential. The authenticated server reloads the latest durable run state before submitting the idempotent resolution.</p>
            </>
          ) : run.targetAuthRepairEligible ? (
            <>
              <p>The target website requires you to repair its authenticated session. Open the isolated repair browser and sign in or complete any required MFA yourself. The platform will not solve or bypass CAPTCHA, MFA, or other security controls.</p>
              <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/takeover/start`} method="post" target="_blank">
                <button className="button" type="submit">Open secure repair browser</button>
              </form>
              <p>When the site is usable again, return here and save the repaired session. The same paused step will then resume through the existing durable resolution authority.</p>
              <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/takeover/finish`} method="post">
                <button className="button" type="submit">Save repaired session &amp; resume</button>
              </form>
              <p className="muted">Browser session IDs and Browser Profile references stay server-side. Duplicate repair starts reuse the active repair session, and Runtime revalidates the durable run/step before execution.</p>
            </>
          ) : (
            <p className="muted">This pause does not expose a safe automated continuation. The platform will keep the run paused rather than guessing or bypassing a security/policy boundary.</p>
          )}
        </section>
      ) : null}

      <section className="grid two">
        <div className="card stack">
          <h2>Failure</h2>
          {run.failure ? (
            <>
              <div className="row"><span>Code</span><strong>{run.failure.code}</strong></div>
              <div className="row"><span>Retryable</span><span>{run.failure.retryable ? "Yes" : "No"}</span></div>
              <div className="row"><span>Step</span><span>{stepHeading(failureStep)}</span></div>
              {failureStep ? <p>{failureStep.objective}</p> : null}
              <div><h3>Evidence</h3><p className="muted">{evidenceSummary(run.failure.evidenceCount)} Use the checkpoint evidence viewer when the same artifacts were persisted on the durable checkpoint.</p></div>
            </>
          ) : <p className="muted">No terminal or attention failure is recorded on the run.</p>}
        </div>

        <div className="card stack">
          <h2>Checkpoint</h2>
          {run.checkpoint ? (
            <>
              <div className="row"><span>Current step</span><strong>{stepHeading(currentStep)}</strong></div>
              <div className="row"><span>Attempt</span><span>{run.checkpoint.attempt}</span></div>
              <div className="row"><span>Repeated state count</span><span>{run.checkpoint.fingerprintRepeatCount}</span></div>
              <div className="row"><span>Updated</span><span className="muted">{run.checkpoint.updatedAt}</span></div>
              <div>
                <h3>Completed steps</h3>
                {completedSteps.length === 0 ? (
                  <p className="muted">{run.checkpoint.completedStepCount === 0 ? "None yet." : `${run.checkpoint.completedStepCount} completed step(s); semantic labels are temporarily unavailable.`}</p>
                ) : (
                  <ul>{completedSteps.map((step) => <li key={step.step}><strong>Step {step.step} · {step.kind}</strong> — {step.objective}</li>)}</ul>
                )}
              </div>
              {run.checkpoint.lastFailure ? <div><h3>Last checkpoint failure</h3><p><strong>{run.checkpoint.lastFailure.code}</strong>{failureStep ? ` at Step ${failureStep.step}` : ""}</p></div> : null}
              <div>
                <h3>Checkpoint evidence</h3>
                <p className="muted">{evidenceSummary(run.checkpoint.evidenceCount)} Artifact storage identities remain server-side; evidence is resolved by authenticated ordinal when opened.</p>
                {evidenceLinks(automationId, runId, run.checkpoint.evidenceCount)}
              </div>
            </>
          ) : <p className="muted">No checkpoint has been persisted for this run.</p>}
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <p className="muted">This view intentionally excludes internal workflow/node identifiers, runtime variables, raw provider/browser errors, selectors, page fingerprints, artifact references, cookies, Browser Profile data, BYOK secrets, workload tokens, and model chain-of-thought. Evidence previews are owner-authenticated, ordinal-resolved, and limited to known-safe browser metadata or bounded screenshots.</p>
      </section>
    </>
  );
}
