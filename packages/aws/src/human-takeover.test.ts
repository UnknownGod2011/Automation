import { describe, expect, it } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  AgentCoreHumanTakeoverBrowser,
  AwsDynamoHumanTakeoverSessionStore,
  type AgentCoreBrowserDataApi,
  type AgentCoreBrowserLiveViewSigner,
} from "./index.js";
import type { HumanTakeoverSessionRecord, OwnershipScope } from "@automation/core";
import type { DynamoDocumentClientLike } from "./dynamodb-state.js";

const scope: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };
const record: HumanTakeoverSessionRecord = {
  tenantId: scope.tenantId,
  userId: scope.userId,
  automationId: "auto-1",
  runId: "run-1",
  nodeId: "submit",
  takeoverId: "takeover-1",
  browserSessionId: "browser-1",
  browserProfileRef: "aws-agentcore-browser-profile://profileA-1234567890",
  startedAt: "2026-08-21T00:00:00.000Z",
  expiresAt: "2026-08-21T00:15:00.000Z",
  status: "ACTIVE",
};

class MemoryDynamo implements DynamoDocumentClientLike {
  item: Record<string, unknown> | undefined;
  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (command instanceof GetCommand) return this.item ? { Item: structuredClone(this.item) } : {};
    if (!(command instanceof PutCommand)) throw new Error("unexpected command");
    const input = command.input;
    if (input.ConditionExpression?.includes("attribute_not_exists") && this.item) {
      const existing = (this.item.record ?? {}) as HumanTakeoverSessionRecord;
      const now = String(input.ExpressionAttributeValues?.[":now"] ?? "");
      if (existing.status !== "COMPLETED" && existing.expiresAt > now) {
        const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
      }
    }
    if (input.ConditionExpression?.includes("#record.#status = :active")) {
      const existing = (this.item?.record ?? {}) as HumanTakeoverSessionRecord;
      if (existing.status !== "ACTIVE" || existing.takeoverId !== input.ExpressionAttributeValues?.[":takeoverId"]) {
        const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
      }
    }
    this.item = structuredClone(input.Item as Record<string, unknown>);
    return {};
  }
}

describe("AwsDynamoHumanTakeoverSessionStore", () => {
  it("persists one active repair session and classifies same-run contention", async () => {
    const client = new MemoryDynamo();
    const store = new AwsDynamoHumanTakeoverSessionStore(client, "state");
    await expect(store.putStarted(record, record.startedAt)).resolves.toBe("CREATED");
    await expect(store.putStarted({ ...record, takeoverId: "other" }, "2026-08-21T00:01:00.000Z")).resolves.toBe("CONFLICT");
    await expect(store.getForRun(scope, "run-1")).resolves.toMatchObject({ takeoverId: "takeover-1", status: "ACTIVE" });
  });

  it("makes completion replayable only for the same takeover identity", async () => {
    const client = new MemoryDynamo();
    const store = new AwsDynamoHumanTakeoverSessionStore(client, "state");
    await store.putStarted(record, record.startedAt);
    await expect(store.complete(scope, "run-1", "takeover-1", "2026-08-21T00:05:00.000Z")).resolves.toBe("COMPLETED");
    await expect(store.complete(scope, "run-1", "takeover-1", "2026-08-21T00:06:00.000Z")).resolves.toBe("REPLAY");
    await expect(store.complete(scope, "run-1", "different", "2026-08-21T00:06:00.000Z")).rejects.toThrow("conflict");
  });
});

describe("AgentCoreHumanTakeoverBrowser", () => {
  it("restores the server-owned profile and returns only bounded Live View material", async () => {
    const calls: Record<string, unknown>[] = [];
    const api: AgentCoreBrowserDataApi = {
      start: async (input) => { calls.push(input as unknown as Record<string, unknown>); return { sessionId: "browser1" }; },
      save: async () => undefined,
      stop: async () => undefined,
    };
    const signer: AgentCoreBrowserLiveViewSigner = {
      sign: async () => "https://bedrock-agentcore.us-east-1.amazonaws.com/live",
    };
    const browser = new AgentCoreHumanTakeoverBrowser(api, signer, "browser-resource", {
      now: () => new Date("2026-08-21T00:00:00.000Z"),
      sessionTimeoutSeconds: 600,
      liveViewTtlSeconds: 300,
    });
    await expect(browser.start(scope, {
      automationId: "auto-1",
      runId: "run-1",
      takeoverId: "takeover-1",
      profileRef: "aws-agentcore-browser-profile://profileA-1234567890",
    })).resolves.toEqual({
      browserSessionId: "browser1",
      liveViewUrl: "https://bedrock-agentcore.us-east-1.amazonaws.com/live",
      expiresAt: "2026-08-21T00:10:00.000Z",
    });
    expect(calls[0]).toMatchObject({ profileIdentifier: "profileA-1234567890", timeoutSeconds: 600 });
  });
});
