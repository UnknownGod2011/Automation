export function workflowIdForAutomation(automationId: string): string {
  const normalized = automationId.trim();
  if (!normalized) throw new Error("automationId is required");
  return normalized;
}

export function freshTestRunId(randomId: () => string = () => crypto.randomUUID()): string {
  const suffix = randomId().trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(suffix)) {
    throw new Error("fresh test identity is invalid");
  }
  return `test-${suffix}`;
}
