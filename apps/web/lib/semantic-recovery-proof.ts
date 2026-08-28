export type SemanticRecoverySummary = {
  trigger: "WORKFLOW_REASONING" | "SEMANTIC_RECOVERY";
};

export type SemanticRecoveryProof =
  | { kind: "NOT_USED" }
  | { kind: "OBSERVED"; recoveryCount: number }
  | { kind: "VERIFIED"; recoveryCount: number };

/**
 * Derives a presentation-only proof state from durable run status and sanitized
 * reasoning summaries. This never grants execution authority or re-verifies an
 * external effect: terminal SUCCEEDED remains the authoritative indication that
 * the execution plane completed all mandatory node verification.
 */
export function semanticRecoveryProof(
  status: string,
  reasoning: readonly SemanticRecoverySummary[],
): SemanticRecoveryProof {
  const recoveryCount = reasoning.reduce(
    (count, summary) => count + (summary.trigger === "SEMANTIC_RECOVERY" ? 1 : 0),
    0,
  );

  if (recoveryCount === 0) return { kind: "NOT_USED" };
  if (status === "SUCCEEDED") return { kind: "VERIFIED", recoveryCount };
  return { kind: "OBSERVED", recoveryCount };
}
