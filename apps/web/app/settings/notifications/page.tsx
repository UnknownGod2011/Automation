import Link from "next/link";
import { notificationPreferenceCopy } from "../../../lib/notification-preferences";
import {
  createAuthenticatedWebControlPlaneClient,
  getWebAuthStatus,
  WebAuthError,
} from "../../../lib/server-auth";
import { WebControlPlaneError } from "../../../lib/control-plane-client";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const auth = await getWebAuthStatus();
  const copy = notificationPreferenceCopy();

  if (auth.kind === "NOT_CONFIGURED") {
    return (
      <section className="card stack">
        <div className="eyebrow">Notification settings</div>
        <h1>Authentication is not configured.</h1>
        <p className="muted">Notification preferences remain unavailable until the authenticated control plane is configured.</p>
      </section>
    );
  }
  if (auth.kind === "SIGNED_OUT") {
    return (
      <section className="card stack">
        <div className="eyebrow">Notification settings</div>
        <h1>Sign in to manage automation notifications.</h1>
        <Link className="button" href="/api/auth/sign-in?returnTo=/settings/notifications">Sign in</Link>
      </section>
    );
  }

  let dashboard;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    dashboard = await client.dashboard();
  } catch (error) {
    if (error instanceof WebAuthError) {
      return (
        <section className="card stack">
          <h1>Sign in again to manage notifications.</h1>
          <Link className="button" href="/api/auth/sign-in?returnTo=/settings/notifications">Sign in</Link>
        </section>
      );
    }
    if (error instanceof WebControlPlaneError) {
      return (
        <section className="card stack">
          <div className="eyebrow">Notification settings</div>
          <h1>Notification preferences are unavailable.</h1>
          <p className="muted">The authenticated control-plane request failed. Provider and internal error details are intentionally hidden.</p>
        </section>
      );
    }
    throw error;
  }

  return (
    <div className="stack">
      {notice === "updated" ? <div className="notice">Notification preferences updated.</div> : null}
      {notice === "request-failed" ? <div className="notice">The update failed safely. Existing preferences were preserved.</div> : null}
      <section className="hero compact">
        <div>
          <div className="eyebrow">Notification settings</div>
          <h1>Automation notifications</h1>
          <p>Choose optional success and ordinary-failure notifications for each automation.</p>
          <p className="muted">{copy.attention}</p>
        </div>
        <div className="card subtle stack">
          <strong>Delivery capability</strong>
          <span className="badge">{dashboard.capabilities.notifications}</span>
          <p className="muted">Preferences remain durable even when a deployment has not configured email delivery yet.</p>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Per-automation preferences</h2>
          <p className="muted">Changing these settings never starts, retries, pauses, or resumes a workflow.</p>
        </div>
        {dashboard.automations.length === 0 ? (
          <div className="card subtle stack">
            <h3>No automations yet</h3>
            <p>Create an automation first, then its notification choices will appear here.</p>
            <Link className="button" href="/automations/new">Create automation</Link>
          </div>
        ) : (
          <div className="list">
            {dashboard.automations.map((automation) => (
              <div className="list-item" key={automation.automationId}>
                <div className="stack">
                  <div className="row"><h3>{automation.name}</h3><span className="badge">{automation.status}</span></div>
                  <div className="muted">{automation.websiteUrl}</div>
                </div>
                <form
                  className="stack"
                  action={`/api/ui/automations/${encodeURIComponent(automation.automationId)}/notifications`}
                  method="post"
                >
                  <label><input type="checkbox" name="notifyOnFailure" value="yes" defaultChecked={automation.notifyOnFailure} /> {copy.failure}</label>
                  <label><input type="checkbox" name="notifyOnSuccess" value="yes" defaultChecked={automation.notifyOnSuccess} /> {copy.success}</label>
                  <p className="muted">{copy.attention}</p>
                  <button className="button secondary" type="submit">Save notification preferences</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
