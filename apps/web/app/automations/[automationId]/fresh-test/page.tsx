import Link from "next/link";
import { WebControlPlaneError } from "../../../../lib/control-plane-client";
import { freshTestStructuredInputFields } from "../../../../lib/fresh-test-input-form";
import { createAuthenticatedWebControlPlaneClient, WebAuthError } from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";

export default async function GuidedFreshTestPage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  let automation;
  let workflow;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    [automation, workflow] = await Promise.all([
      client.automation(automationId),
      client.workflow(automationId),
    ]);
  } catch (error) {
    if (error instanceof WebAuthError) {
      return (
        <section className="card stack">
          <div className="eyebrow">Sign in required</div>
          <h1>Authenticate before entering Fresh Test values.</h1>
          <Link className="button" href={`/api/auth/sign-in?returnTo=${encodeURIComponent(`/automations/${automationId}/fresh-test`)}`}>
            Sign in
          </Link>
        </section>
      );
    }
    if (error instanceof WebControlPlaneError && error.code === "NOT_CONFIGURED") {
      return (
        <section className="card stack">
          <div className="eyebrow">Not configured</div>
          <h1>Fresh Test is unavailable in this deployment.</h1>
          <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link>
        </section>
      );
    }
    return (
      <section className="card stack">
        <h1>Fresh Test inputs are temporarily unavailable.</h1>
        <p>Provider and internal error details are intentionally hidden.</p>
        <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link>
      </section>
    );
  }

  if (!workflow || (automation.status !== "READY_TO_TEST" && automation.status !== "READY_TO_PUBLISH")) {
    return (
      <section className="card stack">
        <div className="eyebrow">Fresh Test not ready</div>
        <h1>Compile a test-ready workflow first.</h1>
        <p>The server rechecks lifecycle state again when Fresh Test is submitted.</p>
        <Link className="button secondary" href={`/automations/${encodeURIComponent(automationId)}`}>
          Back to automation
        </Link>
      </section>
    );
  }

  const fields = freshTestStructuredInputFields(workflow.runtimeInputs);
  if (!fields) {
    return (
      <section className="card stack">
        <div className="eyebrow">Fresh Test blocked</div>
        <h1>The compiled workflow has invalid runtime-input metadata.</h1>
        <p>Recompile the trusted capture rather than guessing at workflow variables.</p>
        <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to automation</Link>
      </section>
    );
  }

  return (
    <section className="card stack">
      <div>
        <div className="eyebrow">Guided Fresh Test</div>
        <h1>Provide this run&apos;s workflow values.</h1>
        <p>
          Capture intentionally did not store the values you typed or selected. Each field below maps server-side to
          the trusted compiled workflow; no internal workflow variable name needs to be copied or edited by you.
        </p>
      </div>
      {fields.length === 0 ? (
        <p className="muted">This workflow has no unresolved captured values. You can run Fresh Test directly.</p>
      ) : (
        <div className="notice">
          These values can become part of durable run checkpoint state. Do not enter passwords, OTPs, API keys,
          tokens, or other authentication secrets. Target-site sign-in belongs in the persisted Browser Profile.
        </div>
      )}
      <form action={`/api/ui/automations/${encodeURIComponent(automationId)}/test`} method="post">
        {fields.map((field, index) => {
          const requirement = workflow.runtimeInputs[index]!;
          return (
            <label key={field.name}>
              Step {requirement.step} runtime value
              <input
                name={field.name}
                type="text"
                maxLength={4_096}
                autoComplete="off"
                aria-label={`Step ${requirement.step} runtime value`}
              />
            </label>
          );
        })}
        <button className="button" type="submit">Run Fresh Test</button>
      </form>
      <p className="muted">
        Submission still revalidates the exact trusted requirement set, OpenAI BYOK readiness, lifecycle state, and
        AgentCore execution admission before browser/model work begins.
      </p>
      <Link href={`/automations/${encodeURIComponent(automationId)}`}>Back to semantic workflow review</Link>
    </section>
  );
}
