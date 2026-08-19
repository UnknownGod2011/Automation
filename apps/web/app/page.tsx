import Link from "next/link";
import { WebControlPlaneClient } from "../lib/control-plane-client";
import { automationPhase, formatCapability, formatSchedule, runTone } from "../lib/view-model";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const client = new WebControlPlaneClient();
  const dashboard = await client.dashboard();
  const configured = client.status().configured;
  const capabilities = Object.entries(dashboard.capabilities) as Array<
    [keyof typeof dashboard.capabilities, (typeof dashboard.capabilities)[keyof typeof dashboard.capabilities]]
  >;

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Cloud browser automation</div>
          <h1>Teach it once. Let the cloud run it.</h1>
          <p>
            Create a permitted workflow, demonstrate it in an isolated browser, verify a fresh test,
            then publish it on your schedule.
          </p>
        </div>
        <div className="card subtle stack">
          <strong>Environment</strong>
          <div className="capabilities">
            {capabilities.map(([name, state]) => (
              <span className="badge" key={name}>{formatCapability(name, state)}</span>
            ))}
          </div>
          {!configured ? (
            <p className="muted">
              The web control plane is not configured. Set the server-only control-plane URL and bearer token to enable mutations.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card stack">
        <div className="row">
          <div>
            <h2>Automations</h2>
            <p className="muted">Status, schedule, latest run, and human-attention state.</p>
          </div>
          <Link className="button" href="/automations/new">Create automation</Link>
        </div>

        {dashboard.automations.length === 0 ? (
          <div className="card subtle">
            <h3>No automations yet</h3>
            <p>{configured ? "Create your first workflow to begin capture." : "Connect the control plane first; no fake cloud data is shown."}</p>
          </div>
        ) : (
          <div className="list">
            {dashboard.automations.map((automation) => (
              <Link className="list-item" href={`/automations/${encodeURIComponent(automation.automationId)}`} key={automation.automationId}>
                <div>
                  <div className="row">
                    <h3>{automation.name}</h3>
                    {automation.needsAttention ? <span className="badge warning">Needs attention</span> : null}
                  </div>
                  <div className="muted">{automation.websiteUrl}</div>
                  <p>{automation.objective}</p>
                </div>
                <div>
                  <div className="badge">{automationPhase(automation)}</div>
                  <p className="muted">{formatSchedule(automation)}</p>
                </div>
                <div>
                  {automation.lastRun ? (
                    <>
                      <span className={`badge ${runTone(automation.lastRun.status)}`}>{automation.lastRun.status}</span>
                      <p className="muted">{automation.lastRun.scheduledAt}</p>
                    </>
                  ) : <span className="muted">No runs yet</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
