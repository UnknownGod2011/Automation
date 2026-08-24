import {
  BedrockAgentCoreControlClient,
  CreateBrowserProfileCommand,
  DeleteBrowserProfileCommand,
  GetBrowserProfileCommand,
  type BedrockAgentCoreControlClientConfig,
} from "@aws-sdk/client-bedrock-agentcore-control";
import type { BrowserProfileStore, OwnershipScope } from "@automation/core";
import { agentCoreClientToken, scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const PROFILE_REF_PREFIX = "aws-agentcore-browser-profile://";
const PROFILE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,47}-[a-zA-Z0-9]{10}$/;

export interface AgentCoreBrowserProfileApi {
  create(input: {
    name: string;
    description: string;
    clientToken: string;
    tags: Readonly<Record<string, string>>;
  }): Promise<{ profileId: string }>;
  get(profileId: string): Promise<void>;
  delete(profileId: string, clientToken: string): Promise<void>;
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

export function isResourceNotFound(error: unknown): boolean {
  return errorName(error) === "ResourceNotFoundException";
}

export function profileRef(profileId: string): string {
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error("AgentCore returned an invalid browser profile identifier");
  }
  return `${PROFILE_REF_PREFIX}${profileId}`;
}

export function parseProfileRef(ref: string): string {
  if (!ref.startsWith(PROFILE_REF_PREFIX)) {
    throw new Error("browser profile reference does not belong to the AWS AgentCore adapter");
  }
  const profileId = ref.slice(PROFILE_REF_PREFIX.length);
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error("invalid AWS AgentCore browser profile reference");
  }
  return profileId;
}

export class AwsSdkAgentCoreBrowserProfileApi implements AgentCoreBrowserProfileApi {
  private readonly client: BedrockAgentCoreControlClient;

  constructor(config: BedrockAgentCoreControlClientConfig | BedrockAgentCoreControlClient) {
    this.client =
      config instanceof BedrockAgentCoreControlClient
        ? config
        : new BedrockAgentCoreControlClient(config);
  }

  async create(input: {
    name: string;
    description: string;
    clientToken: string;
    tags: Readonly<Record<string, string>>;
  }): Promise<{ profileId: string }> {
    const response = await this.client.send(
      new CreateBrowserProfileCommand({
        name: input.name,
        description: input.description,
        clientToken: input.clientToken,
        tags: { ...input.tags },
      }),
    );
    if (!response.profileId) throw new Error("AgentCore CreateBrowserProfile returned no profileId");
    return { profileId: response.profileId };
  }

  async get(profileId: string): Promise<void> {
    await this.client.send(new GetBrowserProfileCommand({ profileId }));
  }

  async delete(profileId: string, clientToken: string): Promise<void> {
    await this.client.send(new DeleteBrowserProfileCommand({ profileId, clientToken }));
  }
}

export class AgentCoreBrowserProfileStore implements BrowserProfileStore {
  constructor(private readonly api: AgentCoreBrowserProfileApi) {}

  async create(scope: OwnershipScope, automationId: string): Promise<string> {
    const identity = scopedResourceIdentity(scope, automationId);
    const token = stableResourceToken(identity);
    const created = await this.api.create({
      name: `automation_${token.slice(0, 24)}`,
      description: "Managed browser profile for Automation cloud execution",
      clientToken: agentCoreClientToken("profile", identity),
      tags: {
        managedBy: "automation-platform",
        scopeHash: token.slice(0, 24),
      },
    });
    return profileRef(created.profileId);
  }

  async exists(_scope: OwnershipScope, ref: string): Promise<boolean> {
    const profileId = parseProfileRef(ref);
    try {
      await this.api.get(profileId);
      return true;
    } catch (error) {
      if (isResourceNotFound(error)) return false;
      throw error;
    }
  }

  async delete(scope: OwnershipScope, ref: string): Promise<void> {
    const profileId = parseProfileRef(ref);
    try {
      await this.api.delete(
        profileId,
        agentCoreClientToken("delete", scopedResourceIdentity(scope, profileId)),
      );
    } catch (error) {
      if (!isResourceNotFound(error)) throw error;
    }
  }
}
