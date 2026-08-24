const CREDENTIAL_CREATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Browser-visible idempotency identity for one Add Credential form attempt.
 * It is not a secret reference or ownership credential; authenticated tenant/user scope remains authoritative.
 */
export function credentialCreationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CREDENTIAL_CREATION_ID_PATTERN.test(normalized) ? normalized : null;
}

export function newCredentialCreationId(randomUuid: () => string): string {
  const id = credentialCreationId(randomUuid());
  if (!id) throw new Error("credential creation id generator returned an invalid UUID");
  return id;
}

export interface CredentialCreateReplayCandidate {
  credentialId: string;
  provider: string;
  maskedLabel: string;
  priority: number;
}

/**
 * A conflict is considered an exact safe replay only when the existing non-secret
 * metadata still matches the original create intent. The API key is intentionally
 * not retrievable for comparison; create replay never overwrites an existing secret.
 */
export function matchesCredentialCreateReplay(
  existing: CredentialCreateReplayCandidate,
  expected: CredentialCreateReplayCandidate,
): boolean {
  return existing.credentialId === expected.credentialId
    && existing.provider.trim().toLowerCase() === expected.provider.trim().toLowerCase()
    && existing.maskedLabel === expected.maskedLabel
    && existing.priority === expected.priority;
}
