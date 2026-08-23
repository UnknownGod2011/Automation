const AUTOMATION_CREATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Browser-visible idempotency identity for one Create Automation form attempt.
 * It is not an ownership credential; authenticated tenant/user scope remains authoritative.
 */
export function automationCreationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return AUTOMATION_CREATION_ID_PATTERN.test(normalized) ? normalized : null;
}

export function newAutomationCreationId(randomUuid: () => string): string {
  const id = automationCreationId(randomUuid());
  if (!id) throw new Error("automation creation id generator returned an invalid UUID");
  return id;
}
