import { describe, expect, it } from "vitest";
import { automationCreationId, newAutomationCreationId } from "./automation-creation-idempotency";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("automation creation idempotency identity", () => {
  it("accepts and normalizes a server-generated UUIDv4", () => {
    expect(automationCreationId(UUID.toUpperCase())).toBe(UUID);
    expect(newAutomationCreationId(() => UUID)).toBe(UUID);
  });

  it.each([
    undefined,
    null,
    "",
    "not-a-uuid",
    "123e4567-e89b-12d3-a456-426614174000",
    "123e4567-e89b-42d3-c456-426614174000",
  ])("rejects malformed creation identities", (value) => {
    expect(automationCreationId(value)).toBeNull();
  });

  it("fails closed when the UUID generator violates the contract", () => {
    expect(() => newAutomationCreationId(() => "bad-id")).toThrow(/invalid UUID/);
  });
});
