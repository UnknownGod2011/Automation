import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@automation/contracts";
import { AutomationProductLifecycleService, InMemoryCaptureTraceRepository } from "./product-lifecycle.js";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryCheckpointRepository,
  InMemoryRunRepository,
  InMemoryScheduler,
  InMemoryWorkflowVersionRepository,
} from "./memory.js";
import type {
  BrowserActionResult,
  BrowserExecutor,
  BrowserProfileStore,
  OwnershipScope,
  ReasoningDecision,
  ReasoningProvider,
  ReasoningRequest,
  VerificationContext,
  VerificationEngine,
  VerificationResult,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };

class CountingProfiles implements BrowserProfileStore {
  createCalls = 0;
  async create(): Promise<string> { this.createCalls += 1; return "profile-ref"; }
  async exists(): Promise<boolean> { return true; }
  async delete(): Promise<void> {}
}

class UnusedBrowser implements BrowserExecutor {
  async executeDeterministic(_scope: OwnershipScope, _runId: string, _node: WorkflowNode): Promise<BrowserActionResult> { throw new Error("browser should not execute"); }
  async executeSemantic(_scope: OwnershipScope, _runId: string, _node: WorkflowNode, _decision: ReasoningDecision): Promise<BrowserActionResult> { throw new Error("browser should not execute"); }
}
class UnusedVerifier implements VerificationEngine {
  async verify(_context: VerificationContext): Promise<VerificationResult> { throw new Error("verification should not execute"); }
}
class UnusedReasoner implements ReasoningProvider {
  async decide(_request: ReasoningRequest): Promise<ReasoningDecision> { throw new Error("reasoning should not execute"); }
}

function service(profiles: CountingProfiles): AutomationProductLifecycleService {
  return new AutomationProductLifecycleService({
    automations: new InMemoryAutomationRepository(),
    captures: new InMemoryCaptureTraceRepository(),
    workflows: new InMemoryWorkflowVersionRepository(),
    runs: new InMemoryRunRepository(),
    checkpoints: new InMemoryCheckpointRepository(),
    profiles,
    scheduler: new InMemoryScheduler(),
    locks: new InMemoryAutomationLockManager(),
    browser: new UnusedBrowser(),
    verifier: new UnusedVerifier(),
    reasoner: new UnusedReasoner(),
  });
}

describe("automation target allocation boundary", () => {
  it.each([
    "http://localhost:3000/",
    "http://10.0.0.8/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "https://user:secret@example.com/",
  ])("rejects %s before allocating a browser profile", async (websiteUrl) => {
    const profiles = new CountingProfiles();
    await expect(service(profiles).createDraft({
      scope,
      automationId: "automation-private-target",
      name: "Private target",
      websiteUrl,
      objective: "Do not reach internal infrastructure",
      consentAcknowledged: true,
    })).rejects.toThrow();
    expect(profiles.createCalls).toBe(0);
  });
});
