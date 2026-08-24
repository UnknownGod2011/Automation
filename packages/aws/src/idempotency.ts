import type { OwnershipScope } from "@automation/core";

function hash32(input: string, seed: number): string {
  let value = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/**
 * Stable, non-secret digest used only for idempotency tokens and opaque resource names.
 * This is deliberately not a password/credential hash.
 */
export function stableResourceToken(input: string): string {
  return [
    2_166_136_261,
    2_654_435_761,
    1_013_904_223,
    3_668_338_649,
    1_144_067_013,
  ]
    .map((seed) => hash32(input, seed))
    .join("");
}

export function scopedResourceIdentity(
  scope: OwnershipScope,
  ...parts: readonly string[]
): string {
  return [scope.tenantId, scope.userId, ...parts].join("\u0000");
}

export function agentCoreClientToken(prefix: string, identity: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9]/g, "");
  if (!safePrefix) throw new Error("AgentCore client token prefix must contain alphanumeric characters");
  const token = `${safePrefix}${stableResourceToken(identity)}`;
  if (token.length < 33 || token.length > 256) {
    throw new Error("AgentCore client token must be between 33 and 256 characters");
  }
  return token;
}
