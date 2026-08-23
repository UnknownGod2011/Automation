import type { ProviderCredentialSummary } from "@automation/core";

const DEPLOYED_REASONING_PROVIDER = "openai";

function credentialRank(a: ProviderCredentialSummary, b: ProviderCredentialSummary): number {
  return (
    a.priority - b.priority ||
    a.failureCount - b.failureCount ||
    a.credentialId.localeCompare(b.credentialId)
  );
}

function credentialIsUsable(credential: ProviderCredentialSummary, nowMs: number): boolean {
  if (credential.status === "HEALTHY" || credential.status === "UNKNOWN") return true;
  if (credential.status !== "COOLDOWN" || !credential.cooldownUntil) return false;
  const cooldownUntil = new Date(credential.cooldownUntil).getTime();
  return Number.isFinite(cooldownUntil) && cooldownUntil <= nowMs;
}

/**
 * Product-level cost/UX preflight for the currently deployed OpenAI-only web product.
 * The execution plane's CredentialPoolPreflightCheck remains authoritative.
 *
 * Same-provider failover is intentionally disabled here to match the production pool policy:
 * only the deterministically ranked primary OpenAI credential can make the web submission ready.
 */
export function hasUsableFreshTestCredential(
  credentials: readonly ProviderCredentialSummary[],
  now: Date = new Date(),
): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;

  const primary = credentials
    .filter((credential) => credential.provider.trim().toLowerCase() === DEPLOYED_REASONING_PROVIDER)
    .slice()
    .sort(credentialRank)[0];

  return primary ? credentialIsUsable(primary, nowMs) : false;
}

export type FreshTestCredentialReadiness =
  | { kind: "READY" }
  | { kind: "NEEDS_CREDENTIAL" }
  | { kind: "UNKNOWN" };

/**
 * Presentation readiness for the authenticated web product.
 * A failed credential-summary lookup is UNKNOWN rather than a hard product outage; the server
 * mutation and execution-plane preflight still re-check authoritative credential state.
 */
export function freshTestCredentialReadiness(
  credentials: readonly ProviderCredentialSummary[] | null,
  now: Date = new Date(),
): FreshTestCredentialReadiness {
  if (credentials === null) return { kind: "UNKNOWN" };
  return hasUsableFreshTestCredential(credentials, now)
    ? { kind: "READY" }
    : { kind: "NEEDS_CREDENTIAL" };
}
