import { randomUUID } from "node:crypto";
import { AUTOMATION_DRAFT_LIMITS } from "@automation/core";
import Link from "next/link";
import { automationCreationId, newAutomationCreationId } from "../../../lib/automation-creation-idempotency";
import { newAutomationAccess } from "../../../lib/new-automation-access";
import { notificationPreferenceCopy } from "../../../lib/notification-preferences";
import { getWebAuthStatus } from "../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; creationAttempt?: string }>;
}) {
  const access = newAutomationAccess(await getWebAuthStatus());
  if (access.kind === "AUTH_NOT_CONFIGURED") {
    return (
      <section className="card stack">
        <div className="eyebrow">Create automation</div>
        <h1>Authentication is not configured.</h1>
        <p className="muted">Automation authoring stays unavailable until the Cognito web session boundary is configured.</p>
        <Link href="/">Back to dashboard</Link>
      </section>
    );
  }
  if (access.kind === "CONTROL_PLANE_NOT_CONFIGURED") {
    return (
      <section className="card stack">
        <div className="eyebrow">Create automation</div>
        <h1>The control plane is not configured.</h1>
        <p className="muted">This deployment cannot persist or execute automations yet, so the product does not collect website or objective metadata that it cannot safely submit.</p>
        <Link href="/">Back to dashboard</Link>
      </section>
    );
  }
  if (access.kind === "SIGN_IN_REQUIRED") {
    return (
      <section className="card stack">
        <div className="eyebrow">Create automation</div>
        <h1>Sign in before entering automation details.</h1>
        <p className="muted">Website, objective, consent, and notification settings are submitted only from an authenticated product session.</p>
        <Link className="button" href="/api/auth/sign-in?returnTo=/automations/new">Sign in</Link>
      </section>
    );
  }

  const { notice, creationAttempt } = await searchParams;
  const creationRequestId = automationCreationId(creationAttempt) ?? newAutomationCreationId(randomUUID);
  const notificationCopy = notificationPreferenceCopy();
  return (
    <section className="grid two">
      <div>
        <div className="eyebrow">Create automation</div>
        <h1>Describe the job before teaching the browser.</h1>
        <p>
          The target URL and objective become durable automation metadata. Authentication happens later inside the isolated capture browser and is not stored in this form.
        </p>
      </div>
      <div className="card">
        {notice === "not-configured" ? <div className="notice">Control plane is not configured on this deployment.</div> : null}
        {notice === "request-failed" ? <div className="notice">The request could not be completed. Retrying this form will reuse the same safe creation attempt instead of creating a second automation.</div> : null}
        <form action="/api/ui/automations" method="post">
          <input name="creationRequestId" type="hidden" value={creationRequestId} />
          <label>Name<input name="name" maxLength={AUTOMATION_DRAFT_LIMITS.name} required placeholder="Daily invoice approval" /></label>
          <label>Website URL<input name="websiteUrl" type="url" maxLength={AUTOMATION_DRAFT_LIMITS.websiteUrl} required placeholder="https://app.example.com" /></label>
          <label>Objective<textarea name="objective" maxLength={AUTOMATION_DRAFT_LIMITS.objective} required placeholder="Open pending invoices, approve those matching our policy, and record the result." /></label>
          <label className="checkbox">
            <input name="consentAcknowledged" type="checkbox" value="true" required />
            <span>I am authorized to automate this website and understand that security controls, MFA, CAPTCHAs, and site restrictions will not be bypassed.</span>
          </label>
          <label className="checkbox"><input name="notifyOnFailure" type="checkbox" value="true" defaultChecked /> <span>{notificationCopy.failure}</span></label>
          <label className="checkbox"><input name="notifyOnSuccess" type="checkbox" value="true" /> <span>{notificationCopy.success}</span></label>
          <p className="muted">{notificationCopy.attention}</p>
          <button className="button" type="submit">Create draft</button>
        </form>
      </div>
    </section>
  );
}
