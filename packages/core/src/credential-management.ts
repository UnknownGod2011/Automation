import type { ProviderCredentialMetadata } from "@automation/contracts";
import type {
  CredentialMetadataRepository,
  CredentialVault,
  OwnershipScope,
} from "./index.js";
import {
  ProviderCredentialService,
  type ProviderCredentialSummary,
} from "./credential-pool.js";

export interface CredentialManagementMetadataRepository
  extends CredentialMetadataRepository {
  delete(scope: OwnershipScope, credentialId: string): Promise<void>;
}

export interface CreateProviderCredentialCommand {
  scope: OwnershipScope;
  credentialId: string;
  provider: string;
  apiKey: string;
  maskedLabel: string;
  priority: number;
}

export interface RotateProviderCredentialCommand {
  scope: OwnershipScope;
  credentialId: string;
  apiKey: string;
}

export interface ProviderCredentialManagementPort {
  create(command: CreateProviderCredentialCommand): Promise<ProviderCredentialSummary>;
  list(scope: OwnershipScope): Promise<readonly ProviderCredentialSummary[]>;
  rotate(command: RotateProviderCredentialCommand): Promise<ProviderCredentialSummary>;
  remove(scope: OwnershipScope, credentialId: string): Promise<boolean>;
}

function requiredToken(value: string, name: string, maxLength = 160): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function apiKey(value: string): string {
  if (value.length < 1) throw new Error("apiKey is required");
  if (value.length > 65_536) throw new Error("apiKey is too long");
  return value;
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

export class ProviderCredentialManagementService
  implements ProviderCredentialManagementPort
{
  private readonly registration: ProviderCredentialService;

  constructor(
    private readonly vault: CredentialVault,
    private readonly metadata: CredentialManagementMetadataRepository,
  ) {
    this.registration = new ProviderCredentialService(vault, metadata);
  }

  async create(command: CreateProviderCredentialCommand): Promise<ProviderCredentialSummary> {
    const credentialId = requiredToken(command.credentialId, "credentialId");
    if (await this.metadata.get(command.scope, credentialId)) {
      throw new Error("credential already exists");
    }
    return this.registration.register({ ...command, credentialId });
  }

  async list(scope: OwnershipScope): Promise<readonly ProviderCredentialSummary[]> {
    return this.registration.list(scope);
  }

  async rotate(command: RotateProviderCredentialCommand): Promise<ProviderCredentialSummary> {
    const credentialId = requiredToken(command.credentialId, "credentialId");
    const existing = await this.metadata.get(command.scope, credentialId);
    if (!existing) throw new Error("credential not found");

    const newSecretRef = await this.vault.put(command.scope, credentialId, {
      value: apiKey(command.apiKey),
    });
    if (newSecretRef !== existing.secretRef) {
      await this.vault.delete(command.scope, newSecretRef);
      throw new Error("credential vault does not support stable-reference rotation");
    }

    const rotated: ProviderCredentialMetadata = {
      tenantId: existing.tenantId,
      userId: existing.userId,
      credentialId: existing.credentialId,
      provider: existing.provider,
      secretRef: existing.secretRef,
      maskedLabel: existing.maskedLabel,
      status: "UNKNOWN",
      priority: existing.priority,
      failureCount: 0,
    };
    await this.metadata.put(rotated);
    return summary(rotated);
  }

  async remove(scope: OwnershipScope, credentialId: string): Promise<boolean> {
    const id = requiredToken(credentialId, "credentialId");
    const existing = await this.metadata.get(scope, id);
    if (!existing) return false;

    // Secret-first deletion is intentional: if metadata deletion fails, a later
    // retry can safely remove the stale metadata, while plaintext capability has
    // already been revoked from the vault.
    await this.vault.delete(scope, existing.secretRef);
    await this.metadata.delete(scope, id);
    return true;
  }
}