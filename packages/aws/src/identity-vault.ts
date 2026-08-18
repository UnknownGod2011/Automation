import {
  BedrockAgentCoreClient,
  GetResourceApiKeyCommand,
  type BedrockAgentCoreClientConfig,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  CreateApiKeyCredentialProviderCommand,
  DeleteApiKeyCredentialProviderCommand,
  UpdateApiKeyCredentialProviderCommand,
  type BedrockAgentCoreControlClientConfig,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  ClassifiedExecutionError,
  type CredentialAccessContext,
  type CredentialSecret,
  type CredentialVault,
  type OwnershipScope,
} from "@automation/core";
import {
  scopedResourceIdentity,
  stableResourceToken,
} from "./idempotency.js";

const SECRET_REF_PREFIX = "aws-agentcore-api-key://";
const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9\-_]{1,128}$/;

export interface AgentCoreApiKeyControlApi {
  create(
    name: string,
    apiKey: string,
    tags: Readonly<Record<string, string>>,
  ): Promise<void>;
  update(name: string, apiKey: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface AgentCoreApiKeyDataApi {
  get(providerName: string, executionIdentityToken: string): Promise<string>;
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

function isConflict(error: unknown): boolean {
  return errorName(error) === "ConflictException";
}

function isNotFound(error: unknown): boolean {
  return errorName(error) === "ResourceNotFoundException";
}

function scopeProviderPrefix(scope: OwnershipScope): string {
  const digest = stableResourceToken(
    scopedResourceIdentity(scope, "agentcore-api-key"),
  );
  return `automation_${digest.slice(0, 16)}_`;
}

function providerName(scope: OwnershipScope, credentialId: string): string {
  const normalizedCredentialId = credentialId.trim();
  if (!normalizedCredentialId) throw new Error("credentialId is required");
  const credentialDigest = stableResourceToken(
    scopedResourceIdentity(scope, normalizedCredentialId),
  );
  const name = `${scopeProviderPrefix(scope)}${credentialDigest.slice(0, 24)}`;
  if (!PROVIDER_NAME_PATTERN.test(name)) {
    throw new Error("generated AgentCore credential provider name is invalid");
  }
  return name;
}

function secretRef(name: string): string {
  if (!PROVIDER_NAME_PATTERN.test(name)) {
    throw new Error("AgentCore credential provider name is invalid");
  }
  return `${SECRET_REF_PREFIX}${name}`;
}

export function parseAgentCoreSecretRef(
  scope: OwnershipScope,
  ref: string,
): string {
  if (!ref.startsWith(SECRET_REF_PREFIX)) {
    throw new Error("secret reference does not belong to the AWS AgentCore Identity adapter");
  }
  const name = ref.slice(SECRET_REF_PREFIX.length);
  if (!PROVIDER_NAME_PATTERN.test(name)) {
    throw new Error("invalid AWS AgentCore Identity secret reference");
  }
  if (!name.startsWith(scopeProviderPrefix(scope))) {
    throw new Error("secret reference is outside the authorized ownership scope");
  }
  return name;
}

function identityTokenRequired(): ClassifiedExecutionError {
  return new ClassifiedExecutionError({
    code: "NOT_CONFIGURED",
    message: "execution identity token is required to access AgentCore Identity credentials",
    retryable: false,
    evidenceRefs: [],
  });
}

export class AwsSdkAgentCoreApiKeyControlApi
  implements AgentCoreApiKeyControlApi
{
  private readonly client: BedrockAgentCoreControlClient;

  constructor(
    config:
      | BedrockAgentCoreControlClientConfig
      | BedrockAgentCoreControlClient,
  ) {
    this.client =
      config instanceof BedrockAgentCoreControlClient
        ? config
        : new BedrockAgentCoreControlClient(config);
  }

  async create(
    name: string,
    apiKey: string,
    tags: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.client.send(
      new CreateApiKeyCredentialProviderCommand({
        name,
        apiKey,
        apiKeySecretSource: "MANAGED",
        tags: { ...tags },
      }),
    );
  }

  async update(name: string, apiKey: string): Promise<void> {
    await this.client.send(
      new UpdateApiKeyCredentialProviderCommand({
        name,
        apiKey,
        apiKeySecretSource: "MANAGED",
      }),
    );
  }

  async delete(name: string): Promise<void> {
    await this.client.send(
      new DeleteApiKeyCredentialProviderCommand({ name }),
    );
  }
}

export class AwsSdkAgentCoreApiKeyDataApi implements AgentCoreApiKeyDataApi {
  private readonly client: BedrockAgentCoreClient;

  constructor(config: BedrockAgentCoreClientConfig | BedrockAgentCoreClient) {
    this.client =
      config instanceof BedrockAgentCoreClient
        ? config
        : new BedrockAgentCoreClient(config);
  }

  async get(
    resourceCredentialProviderName: string,
    workloadIdentityToken: string,
  ): Promise<string> {
    const response = await this.client.send(
      new GetResourceApiKeyCommand({
        resourceCredentialProviderName,
        workloadIdentityToken,
      }),
    );
    if (!response.apiKey) {
      throw new Error("AgentCore Identity returned an empty API key");
    }
    return response.apiKey;
  }
}

export class AgentCoreIdentityCredentialVault implements CredentialVault {
  constructor(
    private readonly control: AgentCoreApiKeyControlApi,
    private readonly data: AgentCoreApiKeyDataApi,
  ) {}

  async put(
    scope: OwnershipScope,
    credentialId: string,
    secret: CredentialSecret,
  ): Promise<string> {
    if (!secret.value) throw new Error("credential secret cannot be empty");
    const name = providerName(scope, credentialId);
    const scopeHash = stableResourceToken(
      scopedResourceIdentity(scope, "credential-tags"),
    ).slice(0, 24);

    try {
      await this.control.create(name, secret.value, {
        managedBy: "automation-platform",
        scopeHash,
      });
    } catch (error) {
      if (!isConflict(error)) throw error;
      await this.control.update(name, secret.value);
    }

    return secretRef(name);
  }

  async get(
    scope: OwnershipScope,
    ref: string,
    access?: CredentialAccessContext,
  ): Promise<CredentialSecret | null> {
    const name = parseAgentCoreSecretRef(scope, ref);
    const token = access?.executionIdentityToken?.trim();
    if (!token) throw identityTokenRequired();

    try {
      const value = await this.data.get(name, token);
      return { value };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(scope: OwnershipScope, ref: string): Promise<void> {
    const name = parseAgentCoreSecretRef(scope, ref);
    try {
      await this.control.delete(name);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
