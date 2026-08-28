import { describe, expect, it } from "vitest";
import { semanticRecoveryProof } from "./semantic-recovery-proof";

describe("semantic recovery proof presentation", () => {
  it("does not claim recovery when no semantic fallback was recorded", () => {
    expect(semanticRecoveryProof("SUCCEEDED", [
      { trigger: "WORKFLOW_REASONING" },
    ])).toEqual({ kind: "NOT_USED" });
  });

  it("marks semantic recovery as observed but unverified until the durable run succeeds", () => {
    expect(semanticRecoveryProof("RUNNING", [
      { trigger: "SEMANTIC_RECOVERY" },
    ])).toEqual({ kind: "OBSERVED", recoveryCount: 1 });

    expect(semanticRecoveryProof("FAILED", [
      { trigger: "SEMANTIC_RECOVERY" },
      { trigger: "SEMANTIC_RECOVERY" },
    ])).toEqual({ kind: "OBSERVED", recoveryCount: 2 });
  });

  it("treats terminal run success as proof that the recorded recovery passed normal verification", () => {
    expect(semanticRecoveryProof("SUCCEEDED", [
      { trigger: "WORKFLOW_REASONING" },
      { trigger: "SEMANTIC_RECOVERY" },
    ])).toEqual({ kind: "VERIFIED", recoveryCount: 1 });
  });
});
