import { AUTOMATION_DRAFT_LIMITS } from "@automation/core";
import { notificationPreferenceCopy } from "../../../lib/notification-preferences";

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
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
        {notice === "request-failed" ? <div className="notice">The request could not be completed. No provider error details were exposed.</div> : null}
        <form action="/api/ui/automations" method="post">
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
