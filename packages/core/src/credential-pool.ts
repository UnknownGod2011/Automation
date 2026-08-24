import type { ProviderCredentialMetadata, RunFailure } from "@automation/contracts";
import type {
  CredentialAccessContext,
  CredentialMetadataRepository,
  CredentialSecret,
  CredentialVault,
  OwnershipScope,
  ReasoningDecision,
  ReasoningProvider,
  ReasoningRequest,
  RunPreflightCheck,
  RunPreflightCheckResult,
} from "./index.js";
import { ClassifiedExecutionError } from "./errors.js";

const DEFAULT_CREDENTIAL_COOLDOWN_MS = 60_000;

export interface ReasoningCredentialPoolPolicy {
  /** Provider preference order. Values are compared case-insensitively. */
  providerOrder: readonly string[];
  /**
   * Disabled by default so multiple keys for one provider are not silently
   * rotated. Enable only when the user explicitly opted into same-provider
   * fallback; this must never be used to evade provider limits.
   */
  allowSameProviderCredentialFailover?: boolean;
  cooldownMs?: number;
}

export interface CredentialBoundReasoningProviderFactory {
  create(input: {
    provider: string;
    credentialId: string;
    secret: CredentialSecret;
  }): ReasoningProvider;
}

export interface CredentialPoolWarningSink {
  warn(message: string): void;
}

export interface CredentialPoolReasoningDependencies {
  metadata: CredentialMetadataRepository;
  vault: CredentialVault;
  providers: CredentialBoundReasoningProviderFactory;
  policy: ReasoningCredentialPoolPolicy;
  accessContext?: (
    request: ReasoningRequest,
  ) => CredentialAccessContext | Promise<CredentialAccessContext>;
  now?: () => Date;
  warnings?: CredentialPoolWarningSink;
}

export interface ProviderCredentialRegistration {
  scope: OwnershipScope;
  credentialId: string;
  provider: string;
  apiKey: string;
  maskedLabel: string;
  priority: number;
}

export interface ProviderCredentialSummary {
  credentialId: string;
  provider: string;
  maskedLabel: string;
  status: ProviderCredentialMetadata["status"];
  priority: number;
  cooldownUntil?: string;
  lastSuccessAt?: string;
  failureCount: number;
}

function token(value: string, name: string, maxLength = 160): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function normalizedProvider(value: string): string {
  return token(value, "provider", 80).toLowerCase();
}

function validatedPolicy(policy: ReasoningCredentialPoolPolicy): {
  providerOrder: readonly string[];
  allowSameProviderCredentialFailover: boolean;
  cooldownMs: number;
} {
  if (policy.providerOrder.length === 0) {
    throw new Error("reasoning credential policy requires at least one provider");
  }
  const providerOrder = policy.providerOrder.map(normalizedProvider);
  if (new Set(providerOrder).size !== providerOrder.length) {
    throw new Error("reasoning credential provider order cannot contain duplicates");
  }
  const cooldownMs = policy.cooldownMs ?? DEFAULT_CREDENTIAL_COOLDOWN_MS;
  if (!Number.isInteger(cooldownMs) || cooldownMs < 1) {
    throw new Error("reasoning credential cooldownMs must be a positive integer");
  }
  return {
    providerOrder,
    allowSameProviderCredentialFailover:
      policy.allowSameProviderCredentialFailover ?? false,
    cooldownMs,
  };
}

function credentialRank(
  a: ProviderCredentialMetadata,
  b: ProviderCredentialMetadata,
): number {
  return (
    a.priority - b.priority ||
    a.failureCount - b.failureCount ||
    a.credentialId.localeCompare(b.credentialId)
  );
}

function usableCredential(
  metadata: ProviderCredentialMetadata,
  nowMs: number,
): boolean {
  if (metadata.status === "HEALTHY" || metadata.status === "UNKNOWN") return true;
  if (metadata.status !== "COOLDOWN" || !metadata.cooldownUntil) return false;
  const cooldownUntil = new Date(metadata.cooldownUntil).getTime();
  return Number.isFinite(cooldownUntil) && cooldownUntil <= nowMs;
}

export function selectProviderCredential(
  records: readonly ProviderCredentialMetadata[],
  policy: ReasoningCredentialPoolPolicy,
  now: Date = new Date(),
): ProviderCredentialMetadata | null {
  const normalized = validatedPolicy(policy);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("credential selection time is invalid");

  for (const provider of normalized.providerOrder) {
    const candidates = records
      .filter((record) => normalizedProvider(record.provider) === provider)
      .sort(credentialRank);
    const primary = candidates[0];
    if (!primary) continue;
    if (usableCredential(primary, nowMs)) return structuredClone(primary);
    if (!normalized.allowSameProviderCredentialFailover) continue;
    const fallback = candidates.slice(1).find((record) => usableCredential(record, nowMs));
    if (fallback) return structuredClone(fallback);
  }
  return null;
}

function sanitizedFailure(
  code: RunFailure["code"],
  message: string,
  nodeId?: string,
  retryable = false,
): ClassifiedExecutionError {
  return new ClassifiedExecutionError({
    code,
    message,
    retryable,
    ...(nodeId ? { nodeId } : {}),
    evidenceRefs: [],
  });
}

function summary(metadata: ProviderCredentialMetadata): ProviderCredentialSummary {
  return {
    credentialId: metadata.credentialId,
    provider: metadata.provider,
    maskedLabel: metadata.maskedLabel,
    status: metadata.status,
    priority: metadata.priority,
    ...(metadata.cooldownUntil ? { cooldownUntil: metadata.cooldownUntil } : {}),
    ...(metadata.lastSuccessAt ? { lastSuccessAt: metadata.lastSuccessAt } : {}),
    failureCount: metadata.failureCount,
  };
}

export class ProviderCredentialService {
  constructor(
    private readonly vault: CredentialVault,
    private readonly metadata: CredentialMetadataRepository,
  ) {}

  async register(request: ProviderCredentialRegistration): Promise<ProviderCredentialSummary> {
    const credentialId = token(request.credentialId, "credentialId");
    const provider = normalizedProvider(request.provider);
    const apiKey = request.apiKey;
    if (apiKey.length < 1) throw new Error("apiKey is required");
    if (apiKey.length > 65_536) throw new Error("apiKey is too long");
    const maskedLabel = token(request.maskedLabel, "maskedLabel", 120);
    if (!Number.isInteger(request.priority) || request.priority < 0 || request.priority > 10_000) {
      throw new Error("credential priority must be an integer between 0 and 10000");
    }

    const existing = await this.metadata.get(request.scope, credentialId);
    if (existing && normalizedProvider(existing.provider) !== provider) {
      throw new Error("credentialId is already bound to another provider");
    }

    const secretRef = await this.vault.put(request.scope, credentialId, { value: apiKey });
    const record: ProviderCredentialMetadata = {
      tenantId: request.scope.tenantId,
      userId: request.scope.userId,
      credentialId,
      provider,
      secretRef,
      maskedLabel,
      status: "UNKNOWN",
      priority: request.priority,
      failureCount: 0,
    };
    await this.metadata.put(record);
    return summary(record);
  }

  async list(scope: OwnershipScope): Promise<readonly ProviderCredentialSummary[]> {
    return (await this.metadata.list(scope)).map(summary);
  }
}

export class CredentialPoolPreflightCheck implements RunPreflightCheck {
  private readonly now: () => Date;

  constructor(
    private readonly metadata: CredentialMetadataRepository,
    private readonly policy: ReasoningCredentialPoolPolicy,
    now: () => Date = () => new Date(),
  ) {
    validatedPolicy(policy);
    this.now = now;
  }

  async check(context: Parameters<RunPreflightCheck["check"]>[0]): Promise<RunPreflightCheckResult> {
    const selected = selectProviderCredential(
      await this.metadata.list(context.scope),
      this.policy,
      this.now(),
    );
    if (selected) return { ready: true };
    return {
      ready: false,
      disposition: "WAITING_FOR_HUMAN",
      failure: {
        code: "NOT_CONFIGURED",
        message: "No usable BYOK reasoning credential is configured",
        retryable: false,
        evidenceRefs: [],
      },
    };
  }
}

export class CredentialPoolReasoningProvider implements ReasoningProvider {
  private readonly policy: ReturnType<typeof validatedPolicy>;
  private readonly now: () => Date;

  constructor(private readonly dependencies: CredentialPoolReasoningDependencies) {
    this.policy = validatedPolicy(dependencies.policy);
    this.now = dependencies.now ?? (() => new Date());
  }

  async decide(request: ReasoningRequest): Promise<ReasoningDecision> {
    const selected = selectProviderCredential(
      await this.dependencies.metadata.list(request.scope),
      this.policy,
      this.now(),
    );
    if (!selected) {
      throw sanitizedFailure(
        "NOT_CONFIGURED",
        "No usable BYOK reasoning credential is configured",
        request.node.id,
      );
    }

    const access = this.dependencies.accessContext
      ? await this.dependencies.accessContext(request)
      : undefined;
    const secret = access
      ? await this.dependencies.vault.get(request.scope, selected.secretRef, access)
      : await this.dependencies.vault.get(request.scope, selected.secretRef);
    if (!secret) {
      await this.updateMetadata(
        this.withFailureState(selected, "DISABLED"),
      );
      throw sanitizedFailure(
        "NOT_CONFIGURED",
        "The selected BYOK reasoning credential is unavailable",
        request.node.id,
      );
    }

    let provider: ReasoningProvider;
    try {
      provider = this.dependencies.providers.create({
        provider: selected.provider,
        credentialId: selected.credentialId,
        secret,
      });
    } catch {
      throw sanitizedFailure(
        "NOT_CONFIGURED",
        "The selected reasoning provider is not configured",
        request.node.id,
      );
    }

    try {
      const decision = await provider.decide(request);
      const { cooldownUntil: _cooldownUntil, ...withoutCooldown } = selected;
      await this.updateMetadata({
        ...withoutCooldown,
        status: "HEALTHY",
        failureCount: 0,
        lastSuccessAt: this.now().toISOString(),
      });
      return decision;
    } catch (error) {
      if (error instanceof ClassifiedExecutionError) {
        await this.updateMetadata(
          this.afterProviderFailure(selected, error.failure, this.now()),
        );
        throw error;
      }
      await this.updateMetadata(
        this.withFailureState(selected, selected.status),
      );
      throw sanitizedFailure(
        "UNKNOWN",
        "Reasoning provider failed",
        request.node.id,
      );
    }
  }

  private afterProviderFailure(
    metadata: ProviderCredentialMetadata,
    failure: RunFailure,
    now: Date,
  ): ProviderCredentialMetadata {
    if (failure.code === "PROVIDER_AUTH_INVALID") {
      return this.withFailureState(metadata, "DISABLED");
    }
    if (failure.code === "PROVIDER_QUOTA_EXHAUSTED") {
      return this.withFailureState(metadata, "EXHAUSTED");
    }
    if (
      failure.code === "PROVIDER_RATE_LIMIT" ||
      failure.code === "TRANSIENT_NETWORK"
    ) {
      const { cooldownUntil: _cooldownUntil, ...withoutCooldown } = metadata;
      return {
        ...withoutCooldown,
        status: "COOLDOWN",
        cooldownUntil: new Date(now.getTime() + this.policy.cooldownMs).toISOString(),
        failureCount: metadata.failureCount + 1,
      };
    }
    return this.withFailureState(metadata, metadata.status);
  }

  private withFailureState(
    metadata: ProviderCredentialMetadata,
    status: ProviderCredentialMetadata["status"],
  ): ProviderCredentialMetadata {
    if (status === "COOLDOWN") {
      return {
        ...metadata,
        failureCount: metadata.failureCount + 1,
      };
    }
    const { cooldownUntil: _cooldownUntil, ...withoutCooldown } = metadata;
    return {
      ...withoutCooldown,
      status,
      failureCount: metadata.failureCount + 1,
    };
  }

  private async updateMetadata(metadata: ProviderCredentialMetadata): Promise<void> {
    try {
      await this.dependencies.metadata.put(metadata);
    } catch {
      this.dependencies.warnings?.warn("credential health metadata update failed");
    }
  }
}
