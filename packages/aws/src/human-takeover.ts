import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type {
  HumanTakeoverBrowserPort,
  HumanTakeoverBrowserSession,
  HumanTakeoverSessionRecord,
  HumanTakeoverSessionStore,
  OwnershipScope,
} from "@automation/core";
import { isResourceNotFound, parseProfileRef } from "./browser-profile.js";
import type { AgentCoreBrowserDataApi } from "./browser-session.js";
import type { AgentCoreBrowserLiveViewSigner } from "./capture-session.js";
import { MAX_BROWSER_SESSION_TIMEOUT_SECONDS } from "./config.js";
import type { DynamoDocumentClientLike } from "./dynamodb-state.js";
import { agentCoreClientToken, scopedResourceIdentity, stableResourceToken } from "./idempotency.js";

const TAKEOVER_PREFIX = "HUMAN_TAKEOVER#";
const DEFAULT_TAKEOVER_TIMEOUT_SECONDS = 900;
const DEFAULT_LIVE_VIEW_TTL_SECONDS = 900;

function encoded(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > 512) throw new Error(`${name} is too long`);
  return encodeURIComponent(normalized);
}

function scopePk(scope: OwnershipScope): string {
  const digest = stableResourceToken(scopedResourceIdentity(scope, "human-takeover"));
  return `SCOPE#${digest.slice(0, 32)}`;
}

function sessionSk(runId: string): string {
  return `${TAKEOVER_PREFIX}${encoded(runId, "runId")}`;
}

function conditionalFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error &&
    String((error as { name?: unknown }).name) === "ConditionalCheckFailedException";
}

function parseRecord(scope: OwnershipScope, item: Record<string, unknown> | undefined): HumanTakeoverSessionRecord | null {
  if (!item) return null;
  if (item.entity !== "HumanTakeoverSession") throw new Error("DynamoDB human-takeover entity mismatch");
  if (!item.record || typeof item.record !== "object" || Array.isArray(item.record)) {
    throw new Error("DynamoDB human-takeover record is invalid");
  }
  const record = structuredClone(item.record as HumanTakeoverSessionRecord);
  if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
    throw new Error("DynamoDB human-takeover ownership mismatch");
  }
  return record;
}

export class AwsDynamoHumanTakeoverSessionStore implements HumanTakeoverSessionStore {
  constructor(private readonly client: DynamoDocumentClientLike, private readonly tableName: string) {
    if (!tableName.trim()) throw new Error("human-takeover DynamoDB tableName is required");
  }

  async putStarted(record: HumanTakeoverSessionRecord, now: string): Promise<"CREATED" | "CONFLICT"> {
    if (record.status !== "ACTIVE" || record.completedAt) {
      throw new Error("new human-takeover session must be ACTIVE without completion metadata");
    }
    const scope = { tenantId: record.tenantId, userId: record.userId };
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: scopePk(scope),
          sk: sessionSk(record.runId),
          entity: "HumanTakeoverSession",
          record: structuredClone(record),
        },
        ConditionExpression: "attribute_not_exists(pk) OR #record.#status = :completed OR #record.#expiresAt <= :now",
        ExpressionAttributeNames: {
          "#record": "record",
          "#status": "status",
          "#expiresAt": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":completed": "COMPLETED",
          ":now": now,
        },
      }));
      return "CREATED";
    } catch (error) {
      if (conditionalFailure(error)) return "CONFLICT";
      throw error;
    }
  }

  async getForRun(scope: OwnershipScope, runId: string): Promise<HumanTakeoverSessionRecord | null> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: scopePk(scope), sk: sessionSk(runId) },
      ConsistentRead: true,
    }));
    const record = parseRecord(scope, response.Item as Record<string, unknown> | undefined);
    if (record && record.runId !== runId) throw new Error("DynamoDB human-takeover run identity mismatch");
    return record;
  }

  async complete(
    scope: OwnershipScope,
    runId: string,
    takeoverId: string,
    completedAt: string,
  ): Promise<"COMPLETED" | "REPLAY"> {
    const current = await this.getForRun(scope, runId);
    if (!current) throw new Error("human-takeover session not found");
    if (current.status === "COMPLETED") {
      if (current.takeoverId !== takeoverId) throw new Error("human-takeover completion conflict");
      return "REPLAY";
    }
    if (current.takeoverId !== takeoverId) throw new Error("human-takeover completion conflict");
    const completed: HumanTakeoverSessionRecord = {
      ...current,
      status: "COMPLETED",
      completedAt,
    };
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: scopePk(scope),
          sk: sessionSk(runId),
          entity: "HumanTakeoverSession",
          record: structuredClone(completed),
        },
        ConditionExpression: "#record.#status = :active AND #record.#takeoverId = :takeoverId",
        ExpressionAttributeNames: {
          "#record": "record",
          "#status": "status",
          "#takeoverId": "takeoverId",
        },
        ExpressionAttributeValues: {
          ":active": "ACTIVE",
          ":takeoverId": takeoverId,
        },
      }));
      return "COMPLETED";
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      const winner = await this.getForRun(scope, runId);
      if (winner?.status === "COMPLETED" && winner.takeoverId === takeoverId) return "REPLAY";
      throw new Error("human-takeover completion conflict");
    }
  }
}

function validateSeconds(value: number, name: string, max = MAX_BROWSER_SESSION_TIMEOUT_SECONDS): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max} seconds`);
  }
}

export interface AgentCoreHumanTakeoverBrowserOptions {
  sessionTimeoutSeconds?: number;
  liveViewTtlSeconds?: number;
  now?: () => Date;
}

export class AgentCoreHumanTakeoverBrowser implements HumanTakeoverBrowserPort {
  private readonly sessionTimeoutSeconds: number;
  private readonly liveViewTtlSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly api: AgentCoreBrowserDataApi,
    private readonly signer: AgentCoreBrowserLiveViewSigner,
    private readonly browserIdentifier: string,
    options: AgentCoreHumanTakeoverBrowserOptions = {},
  ) {
    if (!browserIdentifier.trim()) throw new Error("human-takeover browserIdentifier is required");
    this.sessionTimeoutSeconds = options.sessionTimeoutSeconds ?? DEFAULT_TAKEOVER_TIMEOUT_SECONDS;
    this.liveViewTtlSeconds = options.liveViewTtlSeconds ?? DEFAULT_LIVE_VIEW_TTL_SECONDS;
    validateSeconds(this.sessionTimeoutSeconds, "human-takeover session timeout");
    validateSeconds(this.liveViewTtlSeconds, "human-takeover Live View TTL", this.sessionTimeoutSeconds);
    this.now = options.now ?? (() => new Date());
  }

  async start(
    scope: OwnershipScope,
    request: { automationId: string; runId: string; takeoverId: string; profileRef: string },
  ): Promise<HumanTakeoverBrowserSession> {
    const profileIdentifier = parseProfileRef(request.profileRef);
    const identity = scopedResourceIdentity(
      scope,
      request.automationId,
      request.runId,
      request.takeoverId,
      this.browserIdentifier,
    );
    const resourceToken = stableResourceToken(identity);
    const startedAt = this.now();
    const session = await this.api.start({
      browserIdentifier: this.browserIdentifier,
      name: `repair-${resourceToken.slice(0, 24)}`,
      timeoutSeconds: this.sessionTimeoutSeconds,
      clientToken: agentCoreClientToken("repair-session", identity),
      profileIdentifier,
    });
    try {
      const liveViewUrl = await this.signer.sign(
        this.browserIdentifier,
        session.sessionId,
        this.liveViewTtlSeconds,
      );
      return {
        browserSessionId: session.sessionId,
        liveViewUrl,
        expiresAt: new Date(startedAt.getTime() + this.sessionTimeoutSeconds * 1_000).toISOString(),
      };
    } catch (error) {
      try {
        await this.api.stop(this.browserIdentifier, session.sessionId);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "human-takeover startup and cleanup both failed");
      }
      throw error;
    }
  }

  async liveView(_scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<HumanTakeoverBrowserSession> {
    const remainingSeconds = Math.floor((new Date(record.expiresAt).getTime() - this.now().getTime()) / 1_000);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 1) {
      throw new Error("human-takeover browser session has expired");
    }
    const ttl = Math.min(this.liveViewTtlSeconds, remainingSeconds);
    return {
      browserSessionId: record.browserSessionId,
      liveViewUrl: await this.signer.sign(this.browserIdentifier, record.browserSessionId, ttl),
      expiresAt: record.expiresAt,
    };
  }

  async saveProfile(scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<void> {
    const profileIdentifier = parseProfileRef(record.browserProfileRef);
    const identity = scopedResourceIdentity(
      scope,
      record.automationId,
      record.runId,
      record.takeoverId,
      record.browserSessionId,
      profileIdentifier,
    );
    await this.api.save({
      browserIdentifier: this.browserIdentifier,
      sessionId: record.browserSessionId,
      profileIdentifier,
      clientToken: agentCoreClientToken("repair-save", identity),
    });
  }

  async stop(_scope: OwnershipScope, record: HumanTakeoverSessionRecord): Promise<void> {
    try {
      await this.api.stop(this.browserIdentifier, record.browserSessionId);
    } catch (error) {
      if (!isResourceNotFound(error)) throw error;
    }
  }
}
