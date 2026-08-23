import type { ProviderCredentialSummary } from "@automation/core";
import { describe, expect, it } from "vitest";
import { hasUsableFreshTestCredential } from "./fresh-test-credential-readiness";

function credential(
  overrides: Partial<ProviderCredentialSummary> = {},
): ProviderCredentialSummary {
  return {
    credentialId: "cred-openai",
    provider: "openai",
    maskedLabel: "OpenAI key",
    status: "UNKNOWN",
    priority: 0,
    failureCount: 0,
    ...overrides,
  };
}

describe("Fresh Test credential readiness", () => {
  const now = new Date("2026-08-23T10:00:00.000Z");

  it("accepts the production pool's immediately usable states", () => {
    expect(hasUsableFreshTestCredential([credential({ status: "UNKNOWN" })], now)).toBe(true);
    expect(hasUsableFreshTestCredential([credential({ status: "HEALTHY" })], now)).toBe(true);
  });

  it("accepts cooldown only after its bounded expiry", () => {
    expect(hasUsableFreshTestCredential([
      credential({ status: "COOLDOWN", cooldownUntil: "2026-08-23T09:59:59.000Z" }),
    ], now)).toBe(true);
    expect(hasUsableFreshTestCredential([
      credential({ status: "COOLDOWN", cooldownUntil: "2026-08-23T10:00:01.000Z" }),
    ], now)).toBe(false);
    expect(hasUsableFreshTestCredential([
      credential({ status: "COOLDOWN", cooldownUntil: "not-a-date" }),
    ], now)).toBe(false);
  });

  it("rejects unavailable states and unsupported deployed providers", () => {
    expect(hasUsableFreshTestCredential([credential({ status: "DISABLED" })], now)).toBe(false);
    expect(hasUsableFreshTestCredential([credential({ status: "EXHAUSTED" })], now)).toBe(false);
    expect(hasUsableFreshTestCredential([credential({ provider: "google", status: "HEALTHY" })], now)).toBe(false);
    expect(hasUsableFreshTestCredential([], now)).toBe(false);
  });

  it("matches production no-same-provider-failover semantics", () => {
    const records = [
      credential({ credentialId: "primary", priority: 0, status: "DISABLED" }),
      credential({ credentialId: "secondary", priority: 1, status: "HEALTHY" }),
    ];
    expect(hasUsableFreshTestCredential(records, now)).toBe(false);
  });

  it("uses the same deterministic primary ordering as the credential pool", () => {
    const records = [
      credential({ credentialId: "more-failures", priority: 0, failureCount: 2, status: "DISABLED" }),
      credential({ credentialId: "fewer-failures", priority: 0, failureCount: 1, status: "HEALTHY" }),
      credential({ credentialId: "later-priority", priority: 1, failureCount: 0, status: "HEALTHY" }),
    ];
    expect(hasUsableFreshTestCredential(records, now)).toBe(true);
  });
});
