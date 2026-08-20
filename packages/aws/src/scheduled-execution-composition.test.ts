import type {
  AutomationRecord,
  ProviderCredentialMetadata,
  WorkflowGraph,
  WorkflowNode,
} from "@automation/contracts";
import {
  InMemoryAutomationLockManager,
  InMemoryAutomationRepository,
  InMemoryBrowserProfileStore,
  InMemoryCheckpointRepository,
  InMemoryCredentialMetadataRepository,
  InMemoryRunRepository,
  InMemoryWorkflowVersionRepository,
  type BrowserActionResult,
  type BrowserExecutionRuntime,
  type BrowserExecutionRuntimeFactory,
  type BrowserSessionHandle,
  type BrowserSessionManager,
  type CredentialAccessContext,
  type CredentialBoundReasoningProviderFactory,
  type CredentialSecret,
  type CredentialVault,
  type OwnershipScope,
  type ReasoningDecision,
} from "@automation/core";
import { describe, expect, it } from "vitest";
import {
  AgentCoreRuntimeHeaderWorkloadAccessTokenSource,
  createAwsByokScheduledExecution,
} from "./scheduled-execution-composition.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const otherScope: OwnershipScope = { tenantId: "tenant-2", userId: "user-2" };

const endGraph: WorkflowGraph = {
  schemaVersion: 1,
  workflowId: "wf-1",
  automationId: "auto-1",
  version: 1,
  entryNodeId: "end",
  objective: "Finish",
  createdAt: "2026-08-20T00:00:00.000Z",
  nodes: {
    end: {
      id: "end",
      kind: "END",
      objective: "Finish",
      deterministicStrategies: [],
      inputBindings: {},
      outputBindings: {},
      allowedSideEffects: [],
      retryPolicy: {
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        jitter: false,
        retryableFailureCodes: [],
      },
      timeoutMs: 1_000,
      escalation: "FAIL",
    },
  },
};

const reasonNode: WorkflowNode = {
  id: "reason-1",
  kind: "REASON",
  objective: "Choose a permitted action",
  deterministicStrategies: [],
  inputBindings: {},
  outputBindings: {},
  allowedSideEffects: [],
  retryPolicy: {
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
    jitter: false,
    retryableFailureCodes: [],
  },
  timeoutMs: 1_000,
  escalation: "HUMAN",
};

const decision: ReasoningDecision = {
  summary: "safe action selected",
  action: "CLICK",
  arguments: {},
  confidence: 0.9,
};

class CountingSessions implements BrowserSessionManager {
  starts = 0;

  async start(): Promise<BrowserSessionHandle> {
    this.starts += 1;
    return {
      sessionId: "session-1",
      connection: {
        endpoint: "wss://example.invalid",
        headers: {},
      },
    };
  }

  async saveProfile(): Promise<void> {}
  async stop(): Promise<void> {}
}

class NoopRuntimeFactory implements BrowserExecutionRuntimeFactory {
  async create(): Promise<BrowserExecutionRuntime> {
    return {
      browser: {
        async executeDeterministic(): Promise<BrowserActionResult> {
          return { effectObserved: true, evidenceRefs: [], outputs: {} };
        },
        async executeSemantic(): Promise<BrowserActionResult> {
          return { effectObserved: true, evidenceRefs: [], outputs: {} };
        },
      },
      verifier: {
        async verify() {
          return { verified: true, evidenceRefs: [], detail: "verified" };
        },
      },
      async close() {},
    };
  }
}

class TokenCheckingVault implements CredentialVault {
  observedAccess: CredentialAccessContext | undefined;

  async put(): Promise<string> {
    throw new Error("put is not used by scheduled execution");
  }

  async get(
    _scope: OwnershipScope,
    _secretRef: string,
    access?: CredentialAccessContext,
  ): Promise<CredentialSecret | null> {
    this.observedAccess = access;
    return { value: "provider-secret" };
  }

  async delete(): Promise<void> {
    throw new Error("delete is not used by scheduled execution");
  }
}

function automation(owner: OwnershipScope, browserProfileRef: string): AutomationRecord {
  return {
    tenantId: owner.tenantId,
    userId: owner.userId,
    automationId: "auto-1",
    name: "Scheduled automation",
    websiteUrl: "https://example.com",
    prompt: "Finish the task",
    status: "ACTIVE",
    publishedWorkflowVersion: 1,
    browserProfileRef,
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

async function fixture(withCredential: boolean) {
  const automations = new InMemoryAutomationRepository();
  const workflows = new InMemoryWorkflowVersionRepository();
  const runs = new InMemoryRunRepository();
  const checkpoints = new InMemoryCheckpointRepository();
  const profiles = new InMemoryBrowserProfileStore();
  const locks = new InMemoryAutomationLockManager(
    () => new Date("2026-08-20T03:00:00.000Z"),
  );
  const metadata = new InMemoryCredentialMetadataRepository();
  const vault = new TokenCheckingVault();
  const sessions = new CountingSessions();
  const profileRef = await profiles.create(scope, "auto-1");
  const otherProfileRef = await profiles.create(otherScope, "auto-1");

  await automations.put(automation(scope, profileRef));
  await automations.put(automation(otherScope, otherProfileRef));
  await workflows.putImmutable(scope, endGraph);
  await workflows.putImmutable(otherScope, endGraph);

  if (withCredential) {
    const record: ProviderCredentialMetadata = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      credentialId: "cred-1",
      provider: "openai",
      secretRef: "aws-agentcore-api-key://opaque",
      maskedLabel: "OpenAI",
      status: "HEALTHY",
      priority: 0,
      failureCount: 0,
    };
    await metadata.put(record);
  }

  let observedSecret = "";
  const providers: CredentialBoundReasoningProviderFactory = {
    create: (input) => {
      observedSecret = input.secret.value;
      return { decide: async () => decision };
    },
  };

  const execution = createAwsByokScheduledExecution({
    scope,
    workloadAccessToken: new AgentCoreRuntimeHeaderWorkloadAccessTokenSource({
      WorkloadAccessToken: "trusted-workload-token",
    }),
    coordinator: {
      automations,
      workflows,
      runs,
      checkpoints,
      profiles,
      locks,
      now: () => new Date("2026-08-20T03:00:00.000Z"),
      lockTtlMs: 60_000,
    },
    worker: {
      sessions,
      runtimeFactory: new NoopRuntimeFactory(),
      runs,
      checkpoints,
      browserSessionTimeoutSeconds: 3_600,
      now: () => new Date("2026-08-20T03:00:01.000Z"),
      sleep: async () => undefined,
      jitter: () => 0.5,
    },
    credentials: {
      metadata,
      vault,
      providers,
      policy: { providerOrder: ["openai"] },
    },
  });

  return { execution, metadata, vault, sessions, observedSecret: () => observedSecret };
}

describe("AgentCoreRuntimeHeaderWorkloadAccessTokenSource", () => {
  it("reads the trusted runtime header case-insensitively", () => {
    const source = new AgentCoreRuntimeHeaderWorkloadAccessTokenSource({
      workloadaccesstoken: "runtime-token",
    });
    expect(source.get()).toBe("runtime-token");
  });

  it("fails closed for missing, conflicting, or oversized token material", () => {
    expect(() => new AgentCoreRuntimeHeaderWorkloadAccessTokenSource({}).get()).toThrow(
      "WorkloadAccessToken is required",
    );
    expect(() =>
      new AgentCoreRuntimeHeaderWorkloadAccessTokenSource({
        WorkloadAccessToken: "one",
        workloadaccesstoken: "two",
      }).get(),
    ).toThrow("conflicting AgentCore WorkloadAccessToken headers");
    expect(() =>
      new AgentCoreRuntimeHeaderWorkloadAccessTokenSource({
        WorkloadAccessToken: "x".repeat(131_073),
      }).get(),
    ).toThrow("safety limit");
  });
});

describe("AWS BYOK scheduled execution composition", () => {
  it("blocks a run before browser allocation when no usable BYOK credential exists", async () => {
    const { execution, sessions } = await fixture(false);
    const result = await execution.worker.execute({
      scope,
      automationId: "auto-1",
      scheduledAt: "2026-08-20T03:00:00.000Z",
      runId: "run-no-credential",
    });

    expect(result.kind).toBe("NOT_RUN");
    if (result.kind !== "NOT_RUN") throw new Error("expected preflight block");
    expect(result.preparation.kind).toBe("BLOCKED");
    expect(result.preparation.run.status).toBe("WAITING_FOR_HUMAN");
    expect(sessions.starts).toBe(0);
  });

  it("passes the invocation token only to vault access when reasoning is invoked", async () => {
    const { execution, metadata, vault, observedSecret } = await fixture(true);

    await expect(
      execution.reasoner.decide({
        scope,
        automationId: "auto-1",
        runId: "run-1",
        node: reasonNode,
        objective: reasonNode.objective,
        context: { page: "ready" },
        allowedActions: ["CLICK"],
      }),
    ).resolves.toEqual(decision);

    expect(vault.observedAccess).toEqual({
      executionIdentityToken: "trusted-workload-token",
    });
    expect(observedSecret()).toBe("provider-secret");
    expect(JSON.stringify(await metadata.list(scope))).not.toContain(
      "trusted-workload-token",
    );
  });

  it("rejects cross-tenant invocation reuse before browser compute or secret access", async () => {
    const { execution, vault, sessions } = await fixture(true);
    const result = await execution.worker.execute({
      scope: otherScope,
      automationId: "auto-1",
      scheduledAt: "2026-08-20T03:05:00.000Z",
      runId: "run-wrong-scope",
    });

    expect(result.kind).toBe("NOT_RUN");
    if (result.kind !== "NOT_RUN") throw new Error("expected preflight rejection");
    expect(result.preparation.kind).toBe("FAILED");
    expect(result.preparation.run.failure?.code).toBe("POLICY_BLOCKED");
    expect(sessions.starts).toBe(0);
    expect(vault.observedAccess).toBeUndefined();
  });
});
