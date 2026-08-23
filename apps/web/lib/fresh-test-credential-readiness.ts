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
