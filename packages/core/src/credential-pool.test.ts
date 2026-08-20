import type { ProviderCredentialMetadata, WorkflowNode } from "@automation/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  ClassifiedExecutionError,
  CredentialPoolPreflightCheck,
  CredentialPoolReasoningProvider,
  InMemoryCredentialMetadataRepository,
  InMemoryCredentialVault,
  ProviderCredentialService,
  selectProviderCredential,
  type CredentialBoundReasoningProviderFactory,
  type CredentialVault,
  type OwnershipScope,
  type ReasoningDecision,
  type ReasoningProvider,
  type ReasoningRequest,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const otherScope: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };

const node: WorkflowNode = {
  id: "reason-1",
  kind: "REASON",
  objective: "choose the safe action",
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

function request(requestScope: OwnershipScope = scope): ReasoningRequest {
  return {
    scope: requestScope,
    automationId: "automation-1",
    runId: "run-1",
    node,
    objective: "choose the safe action",
    context: { page: "ready" },
    allowedActions: ["CLICK"],
  };
}

function metadata(
  overrides: Partial<ProviderCredentialMetadata> = {},
): ProviderCredentialMetadata {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    credentialId: "cred-primary",
    provider: "openai",
    secretRef: "memory-secret://primary",
    maskedLabel: "OpenAI primary",
    status: "HEALTHY",
    priority: 10,
    failureCount: 0,
    ...overrides,
  };
}

const decision: ReasoningDecision = {
  summary: "button is ready",
  action: "CLICK",
  arguments: {},
  confidence: 0.9,
};

describe("provider credential selection", () => {
  it("does not silently rotate same-provider credentials without explicit policy", () => {
    const now = new Date("2026-08-20T01:00:00.000Z");
    const selected = selectProviderCredential(
      [
        metadata({
          status: "COOLDOWN",
          cooldownUntil: "2026-08-20T01:05:00.000Z",
          priority: 0,
        }),
        metadata({ credentialId: "cred-secondary", priority: 1 }),
        metadata({ credentialId: "gemini", provider: "google", priority: 0 }),
      ],
      { providerOrder: ["openai", "google"] },
      now,
    );
    expect(selected?.credentialId).toBe("gemini");
  });

  it("allows same-provider fallback only when policy explicitly opts in", () => {
    const selected = selectProviderCredential(
      [
        metadata({ status: "DISABLED", priority: 0 }),
        metadata({ credentialId: "cred-secondary", priority: 1 }),
      ],
      {
        providerOrder: ["openai"],
        allowSameProviderCredentialFailover: true,
      },
      new Date("2026-08-20T01:00:00.000Z"),
    );
    expect(selected?.credentialId).toBe("cred-secondary");
  });
});

describe("ProviderCredentialService", () => {
  it("stores the raw key only through the vault and returns sanitized metadata", async () => {
    const vault = new InMemoryCredentialVault();
    const repository = new InMemoryCredentialMetadataRepository();
    const service = new ProviderCredentialService(vault, repository);

    const result = await service.register({
      scope,
      credentialId: "cred-1",
      provider: "OpenAI",
      apiKey: "sk-super-secret",
      maskedLabel: "Personal OpenAI key",
      priority: 10,
    });

    expect(result).toEqual({
      credentialId: "cred-1",
      provider: "openai",
      maskedLabel: "Personal OpenAI key",
      status: "UNKNOWN",
      priority: 10,
      failureCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain("sk-super-secret");
    expect(JSON.stringify(result)).not.toContain("secretRef");

    const stored = await repository.get(scope, "cred-1");
    expect(stored?.secretRef).toContain("memory-secret://");
    expect(JSON.stringify(stored)).not.toContain("sk-super-secret");
    expect(await repository.get(otherScope, "cred-1")).toBeNull();
  });
});

describe("CredentialPoolReasoningProvider", () => {
  it("resolves the selected secret only at invocation and marks success healthy", async () => {
    const vault = new InMemoryCredentialVault();
    const repository = new InMemoryCredentialMetadataRepository();
    const service = new ProviderCredentialService(vault, repository);
    await service.register({
      scope,
      credentialId: "cred-1",
      provider: "openai",
      apiKey: "secret-value",
      maskedLabel: "OpenAI",
      priority: 0,
    });

    let observedSecret = "";
    const provider: ReasoningProvider = { decide: vi.fn(async () => decision) };
    const factory: CredentialBoundReasoningProviderFactory = {
      create: (input) => {
        observedSecret = input.secret.value;
        return provider;
      },
    };
    const router = new CredentialPoolReasoningProvider({
      metadata: repository,
      vault,
      providers: factory,
      policy: { providerOrder: ["openai"] },
      now: () => new Date("2026-08-20T01:00:00.000Z"),
    });

    await expect(router.decide(request())).resolves.toEqual(decision);
    expect(observedSecret).toBe("secret-value");
    const stored = await repository.get(scope, "cred-1");
    expect(stored?.status).toBe("HEALTHY");
    expect(stored?.failureCount).toBe(0);
    expect(stored?.lastSuccessAt).toBe("2026-08-20T01:00:00.000Z");
  });

  it("passes workload identity context to the vault without exposing it to metadata", async () => {
    const repository = new InMemoryCredentialMetadataRepository();
    await repository.put(metadata({ secretRef: "opaque-ref" }));
    const get = vi.fn(async () => ({ value: "provider-secret" }));
    const vault: CredentialVault = {
      put: vi.fn(async () => "opaque-ref"),
      get,
      delete: vi.fn(async () => undefined),
    };
    const router = new CredentialPoolReasoningProvider({
      metadata: repository,
      vault,
      providers: { create: () => ({ decide: async () => decision }) },
      policy: { providerOrder: ["openai"] },
      accessContext: () => ({ executionIdentityToken: "workload-token" }),
    });

    await router.decide(request());
    expect(get).toHaveBeenCalledWith(scope, "opaque-ref", {
      executionIdentityToken: "workload-token",
    });
    expect(JSON.stringify(await repository.get(scope, "cred-primary"))).not.toContain(
      "workload-token",
    );
  });

  it("disables an invalid credential without automatically replaying against another key", async () => {
    const vault = new InMemoryCredentialVault();
    const repository = new InMemoryCredentialMetadataRepository();
    const service = new ProviderCredentialService(vault, repository);
    await service.register({
      scope,
      credentialId: "cred-1",
      provider: "openai",
      apiKey: "bad-key",
      maskedLabel: "bad",
      priority: 0,
    });
    await service.register({
      scope,
      credentialId: "cred-2",
      provider: "openai",
      apiKey: "second-key",
      maskedLabel: "second",
      priority: 1,
    });

    const calls: string[] = [];
    const router = new CredentialPoolReasoningProvider({
      metadata: repository,
      vault,
      providers: {
        create: ({ credentialId }) => ({
          decide: async () => {
            calls.push(credentialId);
            throw new ClassifiedExecutionError({
              code: "PROVIDER_AUTH_INVALID",
              message: "provider authentication is invalid",
              retryable: false,
              nodeId: node.id,
              evidenceRefs: [],
            });
          },
        }),
      },
      policy: { providerOrder: ["openai"] },
    });

    await expect(router.decide(request())).rejects.toMatchObject({
      failure: { code: "PROVIDER_AUTH_INVALID" },
    });
    expect(calls).toEqual(["cred-1"]);
    expect((await repository.get(scope, "cred-1"))?.status).toBe("DISABLED");

    const preflight = new CredentialPoolPreflightCheck(repository, {
      providerOrder: ["openai"],
    });
    await expect(
      preflight.check({
        scope,
        automation: {} as never,
        graph: {} as never,
        run: {} as never,
      }),
    ).resolves.toMatchObject({
      ready: false,
      disposition: "WAITING_FOR_HUMAN",
      failure: { code: "NOT_CONFIGURED" },
    });
  });

  it("cools down rate-limited credentials with a bounded timestamp", async () => {
    const vault = new InMemoryCredentialVault();
    const repository = new InMemoryCredentialMetadataRepository();
    const service = new ProviderCredentialService(vault, repository);
    await service.register({
      scope,
      credentialId: "cred-1",
      provider: "openai",
      apiKey: "rate-key",
      maskedLabel: "rate",
      priority: 0,
    });
    const router = new CredentialPoolReasoningProvider({
      metadata: repository,
      vault,
      providers: {
        create: () => ({
          decide: async () => {
            throw new ClassifiedExecutionError({
              code: "PROVIDER_RATE_LIMIT",
              message: "provider is rate limited",
              retryable: true,
              nodeId: node.id,
              evidenceRefs: [],
            });
          },
        }),
      },
      policy: { providerOrder: ["openai"], cooldownMs: 30_000 },
      now: () => new Date("2026-08-20T01:00:00.000Z"),
    });

    await expect(router.decide(request())).rejects.toMatchObject({
      failure: { code: "PROVIDER_RATE_LIMIT" },
    });
    const stored = await repository.get(scope, "cred-1");
    expect(stored?.status).toBe("COOLDOWN");
    expect(stored?.cooldownUntil).toBe("2026-08-20T01:00:30.000Z");
    expect(stored?.failureCount).toBe(1);
  });
});
