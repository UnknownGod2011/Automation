import Link from "next/link";
import type { AutomationSummaryView, WorkflowInspectionView } from "@automation/core";
import { runtimeInputSemanticPresentations, type RuntimeInputSemanticPresentation } from "../../../lib/runtime-input-presentation";
import { scheduledStructuredInputFields, type ScheduledStructuredInputField } from "../../../lib/scheduled-input-form";
import {
  createAuthenticatedWebControlPlaneClient,
  getWebAuthStatus,
  WebAuthError,
} from "../../../lib/server-auth";
import { WebControlPlaneError } from "../../../lib/control-plane-client";

export const dynamic = "force-dynamic";

type ConfigurableAutomation = {
  automation: AutomationSummaryView;
  workflow: WorkflowInspectionView;
  fields: readonly ScheduledStructuredInputField[];
  semanticInputs: readonly RuntimeInputSemanticPresentation[];
};

export default async function ScheduledInputSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const auth = await getWebAuthStatus();
  if (auth.kind === "NOT_CONFIGURED") {
    return (
      <section className="card stack">
        <div className="eyebrow">Scheduled inputs</div>
        <h1>Authentication is not configured.</h1>
        <p className="muted">Reusable scheduled values remain unavailable until the authenticated control plane is configured.</p>
      </section>
    );
  }
  if (auth.kind === "SIGNED_OUT") {
    return (
      <section className="card stack">
        <div className="eyebrow">Scheduled inputs</div>
        <h1>Sign in to manage reusable run values.</h1>
        <Link className="button" href="/api/auth/sign-in?returnTo=/settings/inputs">Sign in</Link>
      </section>
    );
  }

  let configurable: readonly ConfigurableAutomation[];
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    const dashboard = await client.dashboard();
    const candidates = dashboard.automations.filter(
      (automation) => automation.status === "ACTIVE" || automation.status === "PAUSED",
    );
    const inspected = await Promise.all(
      candidates.map(async (automation) => ({ automation, workflow: await client.workflow(automation.automationId) })),
    );
    configurable = inspected.flatMap(({ automation, workflow }) => {
      if (!workflow) return [];
      const fields = scheduledStructuredInputFields(workflow.runtimeInputs);
      const semanticInputs = runtimeInputSemanticPresentations(workflow);
      return fields && semanticInputs && fields.length > 0 && fields.length === semanticInputs.length
        ? [{ automation, workflow, fields, semanticInputs }]
        : [];
    });
  } catch (error) {
    if (error instanceof WebAuthError) {
      return (
        <section className="card stack">
          <h1>Sign in again to manage scheduled inputs.</h1>
          <Link className="button" href="/api/auth/sign-in?returnTo=/settings/inputs">Sign in</Link>
        </section>
      );
    }
    if (error instanceof WebControlPlaneError) {
      return (
        <section className="card stack">
          <div className="eyebrow">Scheduled inputs</div>
          <h1>Scheduled inputs are unavailable.</h1>
          <p className="muted">The authenticated control-plane request failed. Internal and provider error details are intentionally hidden.</p>
        </section>
      );
    }
    throw error;
  }

  return (
    <div className="stack">
      {notice === "updated" ? <div className="notice">Scheduled values updated for future runs.</div> : null}
      {notice === "invalid-input" ? <div className="notice">Enter every required value and acknowledge that all of them are non-secret.</div> : null}
      {notice === "request-failed" ? <div className="notice">The update failed safely. Existing scheduled values were preserved.</div> : null}
      {notice === "not-configured" ? <div className="notice">The authenticated control plane is not configured.</div> : null}

      <section className="hero compact">
        <div>
          <div className="eyebrow">Scheduled inputs</div>
          <h1>Reusable values for future runs</h1>
          <p>Change non-secret captured values without reteaching or republishing the immutable workflow.</p>
          <p className="muted">Saved values are write-only here. Existing values and internal workflow-variable names are never returned to the browser.</p>
        </div>
        <div className="card subtle stack">
          <strong>Safety boundary</strong>
          <p className="muted">Use this only for ordinary reusable text or selections. Never store passwords, OTPs, API keys, tokens, or other authentication secrets here.</p>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Published automations with reusable inputs</h2>
          <p className="muted">Updates affect runs admitted after the change. A run already in progress keeps the values captured in its durable checkpoint.</p>
        </div>
        {configurable.length === 0 ? (
          <div className="card subtle stack">
            <h3>No configurable scheduled inputs</h3>
            <p className="muted">Only ACTIVE or PAUSED published workflows with unresolved captured inputs appear here.</p>
            <Link href="/">Back to dashboard</Link>
          </div>
        ) : (
          <div className="list">
            {configurable.map(({ automation, workflow, fields, semanticInputs }) => (
              <div className="list-item" key={automation.automationId}>
                <div className="stack">
                  <div className="row"><h3>{automation.name}</h3><span className="badge">{automation.status}</span></div>
                  <div className="muted">Workflow v{workflow.version} · {automation.websiteUrl}</div>
                  <div className="muted">Provide one reusable value for each semantic workflow step below.</div>
                </div>
                <form
                  className="stack"
                  action={`/api/ui/automations/${encodeURIComponent(automation.automationId)}/scheduled-inputs`}
                  method="post"
                >
                  {fields.map((field, index) => {
                    const presentation = semanticInputs[index]!;
                    return (
                      <label key={field.name}>
                        {presentation.label.replace(" value", " reusable value")}
                        <input
                          name={field.name}
                          type="text"
                          maxLength={4_096}
                          autoComplete="off"
                          aria-label={`${presentation.label} reusable scheduled value`}
                          required
                        />
                        <span className="muted">{presentation.guidance}</span>
                      </label>
                    );
                  })}
                  <label>
                    <input type="checkbox" name="scheduledInputsAreNonSecret" value="yes" required />
                    I confirm every value above is non-secret and safe to persist for future scheduled runs.
                  </label>
                  <button className="button secondary" type="submit">Update scheduled values</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
