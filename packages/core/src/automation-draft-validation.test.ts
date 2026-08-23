import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@automation/contracts";
import {
  AUTOMATION_DRAFT_LIMITS,
  AutomationProductLifecycleService,
  InMemoryCaptureTraceRepository,
} from "./product-lifecycle.js";
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

const owner: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };

class RecordingProfiles implements BrowserProfileStore {
  readonly created: string[] = [];
  async create(_scope: OwnershipScope, automationId: string): Promise<string> {
    this.created.push(automationId);
    return `profile:${automationId}`;
  }
  async exists(): Promise<boolean> { return true; }
  async delete(): Promise<void> {}
}

class UnusedBrowser implements BrowserExecutor {
  async executeDeterministic(_scope: OwnershipScope, _runId: string, _node: WorkflowNode): Promise<BrowserActionResult> {
    throw new Error("browser must not execute while creating a draft");
  }
  async executeSemantic(_scope: OwnershipScope, _runId: string, _node: WorkflowNode, _decision: ReasoningDecision): Promise<BrowserActionResult> {
    throw new Error("browser must not execute while creating a draft");
  }
}

class UnusedVerifier implements VerificationEngine {
  async verify(_context: VerificationContext): Promise<VerificationResult> {
    throw new Error("verification must not execute while creating a draft");
  }
}

class UnusedReasoner implements ReasoningProvider {
  async decide(_request: ReasoningRequest): Promise<ReasoningDecision> {
    throw new Error("reasoning must not execute while creating a draft");
  }
}

function harness() {
  const profiles = new RecordingProfiles();
  const service = new AutomationProductLifecycleService({
    automations: new InMemoryAutomationRepository(),
    captures: new InMemoryCaptureTraceRepository(),
    workflows: new InMemoryWorkflowVersionRepository(),
    runs: new InMemoryRunRepository(),
    checkpoints: new InMemoryCheckpointRepository(),
    profiles,
    scheduler: new InMemoryScheduler(),
    locks: new InMemoryAutomationLockManager(() => new Date("2026-08-23T00:00:00.000Z")),
    browser: new UnusedBrowser(),
    verifier: new UnusedVerifier(),
    reasoner: new UnusedReasoner(),
    now: () => new Date("2026-08-23T00:00:00.000Z"),
  });
  return { service, profiles };
}

function baseRequest() {
  return {
    scope: owner,
    automationId: "automation-1",
    name: "Daily invoice approval",
    websiteUrl: "https://example.com/app",
    objective: "Approve invoices that satisfy the policy",
    consentAcknowledged: true,
  } as const;
}

describe("automation draft metadata bounds", () => {
  it.each([
    ["automationId", "a".repeat(AUTOMATION_DRAFT_LIMITS.automationId + 1), "automationId"],
    ["name", "n".repeat(AUTOMATION_DRAFT_LIMITS.name + 1), "name"],
    ["objective", "o".repeat(AUTOMATION_DRAFT_LIMITS.objective + 1), "objective"],
    ["websiteUrl", `https://example.com/${"a".repeat(AUTOMATION_DRAFT_LIMITS.websiteUrl)}`, "websiteUrl"],
  ] as const)("rejects oversized %s before Browser Profile allocation", async (field, value, message) => {
    const { service, profiles } = harness();
    await expect(service.createDraft({ ...baseRequest(), [field]: value })).rejects.toThrow(message);
    expect(profiles.created).toEqual([]);
  });

  it("accepts exact durable boundaries and allocates the Browser Profile only after validation", async () => {
    const { service, profiles } = harness();
    const prefix = "https://example.com/";
    const websiteUrl = prefix + "a".repeat(AUTOMATION_DRAFT_LIMITS.websiteUrl - prefix.length);
    const record = await service.createDraft({
      ...baseRequest(),
      automationId: "a".repeat(AUTOMATION_DRAFT_LIMITS.automationId),
      name: "n".repeat(AUTOMATION_DRAFT_LIMITS.name),
      websiteUrl,
      objective: "o".repeat(AUTOMATION_DRAFT_LIMITS.objective),
    });

    expect(record.automationId).toHaveLength(AUTOMATION_DRAFT_LIMITS.automationId);
    expect(record.name).toHaveLength(AUTOMATION_DRAFT_LIMITS.name);
    expect(record.websiteUrl).toHaveLength(AUTOMATION_DRAFT_LIMITS.websiteUrl);
    expect(record.prompt).toHaveLength(AUTOMATION_DRAFT_LIMITS.objective);
    expect(profiles.created).toEqual([record.automationId]);
  });
});
