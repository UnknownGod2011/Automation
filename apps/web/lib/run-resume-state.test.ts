import { describe, expect, it } from "vitest";
import type { RunDetailView } from "@automation/core";
import { serverResolvedHumanResumeNode } from "./run-resume-state.js";

function detail(overrides: Partial<RunDetailView> = {}): RunDetailView {
  return {
    runId: "run-1",
    automationId: "auto-1",
    workflowVersion: 1,
    status: "WAITING_FOR_HUMAN",
    scheduledAt: "2026-08-22T02:00:00.000Z",
    currentNodeId: "human-approve",
    checkpoint: {
      currentNodeId: "human-approve",
      completedNodeIds: ["open"],
      attempt: 1,
      fingerprintRepeatCount: 0,
      evidenceRefs: [],
      updatedAt: "2026-08-22T02:00:02.000Z",
    },
    needsHumanAttention: true,
    humanResumeEligible: true,
    ...overrides,
  };
}

describe("serverResolvedHumanResumeNode", () => {
  it("uses the latest authenticated durable node rather than a browser-supplied identifier", () => {
    expect(serverResolvedHumanResumeNode(detail())).toBe("human-approve");
  });

  it("fails closed when run and checkpoint disagree", () => {
    expect(serverResolvedHumanResumeNode(detail({
      checkpoint: {
        currentNodeId: "another-node",
        completedNodeIds: [],
        attempt: 1,
        fingerprintRepeatCount: 0,
        evidenceRefs: [],
        updatedAt: "2026-08-22T02:00:02.000Z",
      },
    }))).toBeNull();
  });

  it("does not resolve a node when semantic eligibility is false", () => {
    expect(serverResolvedHumanResumeNode(detail({ humanResumeEligible: false }))).toBeNull();
  });
});
