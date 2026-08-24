import {
  BedrockAgentCoreClient,
  SaveBrowserSessionProfileCommand,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
  type BedrockAgentCoreClientConfig,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  BrowserAutomationConnection,
  BrowserSessionHandle,
  BrowserSessionManager,
  BrowserSessionStartRequest,
  BrowserViewport,
  OwnershipScope,
} from "@automation/core";
import { Browser } from "bedrock-agentcore/browser";
import { isResourceNotFound, parseProfileRef } from "./browser-profile.js";
import { MAX_BROWSER_SESSION_TIMEOUT_SECONDS } from "./config.js";
import { agentCoreClientToken, scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const SESSION_ID_PATTERN = /^[0-9a-zA-Z]{1,40}$/;

export interface AgentCoreBrowserSessionStartInput {
  browserIdentifier: string;
  name: string;
  timeoutSeconds: number;
  clientToken: string;
  profileIdentifier?: string;
  viewport?: BrowserViewport;
}

export interface AgentCoreBrowserSessionSaveInput {
  browserIdentifier: string;
  sessionId: string;
  profileIdentifier: string;
  clientToken: string;
}

export interface AgentCoreBrowserDataApi {
  start(input: AgentCoreBrowserSessionStartInput): Promise<{ sessionId: string }>;
  save(input: AgentCoreBrowserSessionSaveInput): Promise<void>;
  stop(browserIdentifier: string, sessionId: string): Promise<void>;
}

export interface AgentCoreBrowserConnectionSigner {
  sign(browserIdentifier: string, sessionId: string): Promise<BrowserAutomationConnection>;
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("AgentCore returned an invalid browser session identifier");
  }
}

function validateTimeout(timeoutSeconds: number): void {
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > MAX_BROWSER_SESSION_TIMEOUT_SECONDS
  ) {
    throw new Error(
      `browser session timeout must be an integer between 1 and ${MAX_BROWSER_SESSION_TIMEOUT_SECONDS} seconds`,
    );
  }
}

export class AwsSdkAgentCoreBrowserDataApi implements AgentCoreBrowserDataApi {
  private readonly client: BedrockAgentCoreClient;

  constructor(config: BedrockAgentCoreClientConfig | BedrockAgentCoreClient) {
    this.client =
      config instanceof BedrockAgentCoreClient ? config : new BedrockAgentCoreClient(config);
  }

  async start(input: AgentCoreBrowserSessionStartInput): Promise<{ sessionId: string }> {
    const response = await this.client.send(
      new StartBrowserSessionCommand({
        browserIdentifier: input.browserIdentifier,
        name: input.name,
        sessionTimeoutSeconds: input.timeoutSeconds,
        clientToken: input.clientToken,
        ...(input.profileIdentifier
          ? { profileConfiguration: { profileIdentifier: input.profileIdentifier } }
          : {}),
        ...(input.viewport
          ? { viewPort: { width: input.viewport.width, height: input.viewport.height } }
          : {}),
      }),
    );
    if (!response.sessionId) throw new Error("AgentCore StartBrowserSession returned no sessionId");
    validateSessionId(response.sessionId);
    return { sessionId: response.sessionId };
  }

  async save(input: AgentCoreBrowserSessionSaveInput): Promise<void> {
    await this.client.send(
      new SaveBrowserSessionProfileCommand({
        browserIdentifier: input.browserIdentifier,
        sessionId: input.sessionId,
        profileIdentifier: input.profileIdentifier,
        clientToken: input.clientToken,
      }),
    );
  }

  async stop(browserIdentifier: string, sessionId: string): Promise<void> {
    await this.client.send(new StopBrowserSessionCommand({ browserIdentifier, sessionId }));
  }
}

export class AwsAgentCoreBrowserConnectionSigner implements AgentCoreBrowserConnectionSigner {
  constructor(private readonly region: string) {}

  async sign(browserIdentifier: string, sessionId: string): Promise<BrowserAutomationConnection> {
    validateSessionId(sessionId);
    const browser = new Browser({ region: this.region, identifier: browserIdentifier });
    browser.attachSession(sessionId);
    const connection = await browser.generateWebSocketUrl();
    return {
      endpoint: connection.url,
      headers: { ...connection.headers },
    };
  }
}

export class AgentCoreBrowserSessionManager implements BrowserSessionManager {
  constructor(
    private readonly api: AgentCoreBrowserDataApi,
    private readonly signer: AgentCoreBrowserConnectionSigner,
    private readonly browserIdentifier: string,
  ) {}

  async start(
    scope: OwnershipScope,
    request: BrowserSessionStartRequest,
  ): Promise<BrowserSessionHandle> {
    validateTimeout(request.timeoutSeconds);
    const profileIdentifier = request.profileRef
      ? parseProfileRef(request.profileRef)
      : undefined;
    const identity = scopedResourceIdentity(
      scope,
      request.automationId,
      request.runId,
      this.browserIdentifier,
    );
    const token = stableResourceToken(identity);

    const session = await this.api.start({
      browserIdentifier: this.browserIdentifier,
      name: `automation-${token.slice(0, 24)}`,
      timeoutSeconds: request.timeoutSeconds,
      clientToken: agentCoreClientToken("session", identity),
      ...(profileIdentifier ? { profileIdentifier } : {}),
      ...(request.viewport ? { viewport: request.viewport } : {}),
    });
    validateSessionId(session.sessionId);

    try {
      const connection = await this.signer.sign(this.browserIdentifier, session.sessionId);
      return { sessionId: session.sessionId, connection };
    } catch (error) {
      try {
        await this.api.stop(this.browserIdentifier, session.sessionId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "AgentCore browser connection signing failed and session cleanup also failed",
        );
      }
      throw error;
    }
  }

  async saveProfile(
    scope: OwnershipScope,
    session: BrowserSessionHandle,
    profileRef: string,
  ): Promise<void> {
    validateSessionId(session.sessionId);
    const profileIdentifier = parseProfileRef(profileRef);
    const identity = scopedResourceIdentity(
      scope,
      this.browserIdentifier,
      session.sessionId,
      profileIdentifier,
    );
    await this.api.save({
      browserIdentifier: this.browserIdentifier,
      sessionId: session.sessionId,
      profileIdentifier,
      clientToken: agentCoreClientToken("saveprofile", identity),
    });
  }

  async stop(_scope: OwnershipScope, session: BrowserSessionHandle): Promise<void> {
    validateSessionId(session.sessionId);
    try {
      await this.api.stop(this.browserIdentifier, session.sessionId);
    } catch (error) {
      if (!isResourceNotFound(error)) throw error;
    }
  }
}
