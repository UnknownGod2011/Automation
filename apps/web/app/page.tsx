import Link from "next/link";
import { createAuthenticatedWebControlPlaneClient, getWebAuthStatus, WebAuthError } from "../lib/server-auth";
import { dashboardCreateAutomationPresentation } from "../lib/dashboard-create";
import { dashboardLastRunPresentation } from "../lib/dashboard-last-run";
import { automationPhase, formatCapability, formatSchedule, nextRunLabel } from "../lib/view-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const auth = await getWebAuthStatus();
  if (auth.kind === "NOT_CONFIGURED") {
    return (
      <section className="hero">
        <div>
          <div className="eyebrow">Cloud browser automation</div>
          <h1>Teach it once. Let the cloud run it.</h1>
          <p>Authentication is not configured for this deployment. No fake user or cloud data is shown.</p>
        </div>
        <div className="card subtle stack"><strong>Environment</strong><span className="badge warning">Auth: not configured</span></div>
      </section>
    );
  }
  if (auth.kind === "SIGNED_OUT") {
    return (
      <section className="hero">
        <div>
          <div className="eyebrow">Cloud browser automation</div>
          <h1>Teach it once. Let the cloud run it.</h1>
          <p>Create a permitted workflow, demonstrate it in an isolated browser, verify a fresh test, then publish it on your schedule.</p>
          <Link className="button" href="/api/auth/sign-in?returnTo=/">Sign in with Google or email</Link>
        </div>
        <div className="card subtle stack"><strong>Secure session</strong><p className="muted">OAuth authorization-code flow with PKCE. Browser JavaScript never receives the control-plane access or refresh token.</p></div>
      </section>
    );
  }

  let client;
  let dashboard;
  try {
    client = await createAuthenticatedWebControlPlaneClient();
    dashboard = await client.dashboard();
  } catch (error) {
    if (error instanceof WebAuthError) {
      return (
        <section className="card stack">
          <div className="eyebrow">Session expired</div>
          <h1>Sign in again to continue.</h1>
          <Link className="button" href="/api/auth/sign-in?returnTo=/">Sign in</Link>
        </section>
      );
    }
    throw error;
  }
  const configured = client.status().configured;
  const createAction = dashboardCreateAutomationPresentation(configured);
  const renderedAt = new Date();
  const capabilities = Object.entries(dashboard.capabilities) as Array<
    [keyof typeof dashboard.capabilities, (typeof dashboard.capabilities)[keyof typeof dashboard.capabilities]]
  >;

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Cloud browser automation</div>
          <h1>Teach it once. Let the cloud run it.</h1>
          <p>Create a permitted workflow, demonstrate it in an isolated browser, verify a fresh test, then publish it on your schedule.</p>
        </div>
        <div className="card subtle stack">
          <strong>Environment</strong>
          <div className="capabilities">{capabilities.map(([name, state]) => <span className="badge" key={name}>{formatCapability(name, state)}</span>)}</div>
          {!configured ? <p className="muted">The authenticated control-plane URL is not configured; mutations remain disabled.</p> : null}
        </div>
      </section>

      <section className="card stack">
        <div className="row">
          <div><h2>Automations</h2><p className="muted">Status, schedule, next run, latest run, and human-attention state.</p></div>
          {createAction.kind === "READY"
            ? <Link className="button" href="/automations/new">{createAction.label}</Link>
            : <span className="badge warning" title={createAction.message}>{createAction.label}</span>}
        </div>
        {dashboard.automations.length === 0 ? (
          <div className="card subtle"><h3>No automations yet</h3><p>{configured ? "Create your first workflow to begin capture." : createAction.kind === "BLOCKED" ? createAction.message : "Creation is unavailable."}</p></div>
        ) : (
          <div className="list">
            {dashboard.automations.map((automation) => {
              const lastRun = automation.lastRun ? dashboardLastRunPresentation(automation.lastRun) : null;
              return (
                <Link className="list-item" href={`/automations/${encodeURIComponent(automation.automationId)}`} key={automation.automationId}>
                  <div><div className="row"><h3>{automation.name}</h3>{automation.needsAttention ? <span className="badge warning">Needs attention</span> : null}</div><div className="muted">{automation.websiteUrl}</div><p>{automation.objective}</p></div>
                  <div><div className="badge">{automationPhase(automation)}</div><p className="muted">{formatSchedule(automation)}</p><p className="muted">{nextRunLabel(automation, renderedAt)}</p></div>
                  <div>{lastRun && automation.lastRun ? <><strong>{lastRun.kind}</strong><br /><span className={`badge ${lastRun.tone}`}>{automation.lastRun.status}</span><p className="muted">{lastRun.detail}</p><p className="muted">{automation.lastRun.scheduledAt}</p></> : <span className="muted">No runs yet</span>}</div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
