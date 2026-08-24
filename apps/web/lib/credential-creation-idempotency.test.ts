import { describe, expect, it } from "vitest";
import {
  credentialCreationId,
  matchesCredentialCreateReplay,
  newCredentialCreationId,
} from "./credential-creation-idempotency";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("credential creation idempotency", () => {
  it("accepts and normalizes a UUIDv4 creation identity", () => {
    expect(credentialCreationId(UUID.toUpperCase())).toBe(UUID);
    expect(newCredentialCreationId(() => UUID)).toBe(UUID);
  });

  it.each([
    undefined,
    null,
    "",
    "not-a-uuid",
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-42d3-c456-426614174000",
  ])("rejects malformed creation identities", (value) => {
    expect(credentialCreationId(value)).toBeNull();
  });

  it("fails closed when the UUID generator violates the contract", () => {
    expect(() => newCredentialCreationId(() => "bad-id")).toThrow(/invalid UUID/);
  });

  it("classifies only exact non-secret metadata as a safe replay", () => {
    const expected = {
      credentialId: UUID,
      provider: "openai",
      maskedLabel: "Personal OpenAI key",
      priority: 0,
    };
    expect(matchesCredentialCreateReplay({ ...expected, provider: "OPENAI" }, expected)).toBe(true);
    expect(matchesCredentialCreateReplay({ ...expected, maskedLabel: "Work key" }, expected)).toBe(false);
    expect(matchesCredentialCreateReplay({ ...expected, priority: 1 }, expected)).toBe(false);
    expect(matchesCredentialCreateReplay({ ...expected, credentialId: "123e4567-e89b-42d3-a456-426614174001" }, expected)).toBe(false);
  });
});
