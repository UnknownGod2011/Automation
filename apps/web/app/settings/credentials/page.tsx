import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  credentialCreationId,
  newCredentialCreationId,
} from "../../../lib/credential-creation-idempotency";
import { WEB_BYOK_PROVIDER_OPTIONS } from "../../../lib/credential-form";
import {
  createAuthenticatedWebControlPlaneClient,
  getWebAuthStatus,
  WebAuthError,
} from "../../../lib/server-auth";
import { WebControlPlaneError } from "../../../lib/control-plane-client";

export const dynamic = "force-dynamic";

export default async function CredentialSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; creationAttempt?: string }>;
}) {
  const auth = await getWebAuthStatus();
  if (auth.kind === "NOT_CONFIGURED") {
    return (
      <section className="card stack">
        <div className="eyebrow">BYOK settings</div>
        <h1>Authentication is not configured.</h1>
        <p className="muted">Credential management remains unavailable until the Cognito control plane is configured.</p>
      </section>
    );
  }
  if (auth.kind === "SIGNED_OUT") {
    return (
      <section className="card stack">
        <div className="eyebrow">BYOK settings</div>
        <h1>Sign in to manage model credentials.</h1>
        <Link className="button" href="/api/auth/sign-in?returnTo=/settings/credentials">Sign in</Link>
      </section>
    );
  }

  let credentials;
  try {
    const client = await createAuthenticatedWebControlPlaneClient();
    credentials = await client.credentials();
  } catch (error) {
    if (error instanceof WebAuthError) {
      return (
        <section className="card stack">
          <h1>Sign in again to manage credentials.</h1>
          <Link className="button" href="/api/auth/sign-in?returnTo=/settings/credentials">Sign in</Link>
        </section>
      );
    }
    if (error instanceof WebControlPlaneError) {
      return (
        <section className="card stack">
          <div className="eyebrow">BYOK settings</div>
          <h1>Credential management is unavailable.</h1>
          <p className="muted">The deployment has not configured the secure credential-management boundary. No placeholder secret storage is used.</p>
        </section>
      );
    }
    throw error;
  }

  const { notice, creationAttempt } = await searchParams;
  const credentialCreationRequestId = credentialCreationId(creationAttempt) ?? newCredentialCreationId(randomUUID);

  return (
    <div className="stack">
      <section className="hero compact">
        <div>
          <div className="eyebrow">BYOK settings</div>
          <h1>Reasoning credentials</h1>
          <p>Add provider API keys for cloud reasoning. Keys are submitted only to the authenticated server boundary; this page receives sanitized metadata after storage.</p>
        </div>
        <div className="card subtle stack">
          <strong>Secret boundary</strong>
          <p className="muted">Raw keys are not returned to the browser after submission and are not stored in workflow or run metadata.</p>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Add credential</h2>
          <p className="muted">This AWS-first deployment currently executes BYOK reasoning with OpenAI. Additional provider adapters must be implemented and deployed before they appear here.</p>
        </div>
        {notice === "request-failed" ? <div className="notice">The request result was uncertain. Re-enter the key and retry; this page will reuse the same credential creation attempt instead of creating a second credential.</div> : null}
        {notice === "not-configured" ? <div className="notice">Credential management is not configured on this deployment.</div> : null}
        {notice === "credential-added" ? <div className="notice">Credential stored securely.</div> : null}
        <form className="stack" action="/api/ui/credentials" method="post">
          <input type="hidden" name="action" value="create" />
          <input type="hidden" name="creationRequestId" value={credentialCreationRequestId} />
          <label className="stack">
            <span>Provider</span>
            <select required name="provider" defaultValue={WEB_BYOK_PROVIDER_OPTIONS[0].value}>
              {WEB_BYOK_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="stack"><span>Label</span><input required name="maskedLabel" autoComplete="off" placeholder="Personal OpenAI key" /></label>
          <label className="stack"><span>Priority</span><input required name="priority" type="number" min="0" max="10000" defaultValue="0" /></label>
          <label className="stack"><span>API key</span><input required name="apiKey" type="password" autoComplete="off" /></label>
          <button className="button" type="submit">Store credential securely</button>
        </form>
      </section>

      <section className="card stack">
        <div><h2>Configured credentials</h2><p className="muted">Only sanitized health and routing metadata is shown. Legacy credentials for providers not supported by this deployment remain visible for removal or rotation, but are not offered as new product choices.</p></div>
        {credentials.length === 0 ? (
          <div className="card subtle"><h3>No credentials configured</h3><p>Add an OpenAI BYOK key before publishing reasoning-dependent automations.</p></div>
        ) : (
          <div className="list">
            {credentials.map((credential) => (
              <div className="list-item" key={credential.credentialId}>
                <div className="stack">
                  <div className="row"><h3>{credential.maskedLabel}</h3><span className="badge">{credential.status}</span></div>
                  <div className="muted">{credential.provider} · priority {credential.priority} · failures {credential.failureCount}</div>
                  {credential.cooldownUntil ? <div className="muted">Cooldown until {credential.cooldownUntil}</div> : null}
                  {credential.lastSuccessAt ? <div className="muted">Last success {credential.lastSuccessAt}</div> : null}
                </div>
                <form className="stack" action="/api/ui/credentials" method="post">
                  <input type="hidden" name="action" value="rotate" />
                  <input type="hidden" name="credentialId" value={credential.credentialId} />
                  <label className="stack"><span>Replacement key</span><input required name="apiKey" type="password" autoComplete="off" /></label>
                  <button className="button secondary" type="submit">Rotate key</button>
                </form>
                <form action="/api/ui/credentials" method="post">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="credentialId" value={credential.credentialId} />
                  <button className="button secondary" type="submit">Remove</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
