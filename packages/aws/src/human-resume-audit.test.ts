import { describe, expect, it } from "vitest";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  AwsDynamoHumanResumeAuditStore,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";
import type { HumanResumeAuditEvent } from "@automation/core";

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly commands: Array<PutCommand | QueryCommand> = [];

  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (command instanceof PutCommand) {
      this.commands.push(command);
      const item = command.input.Item as Record<string, unknown>;
      const key = keyOf(item);
      if (this.items.has(key)) {
        throw Object.assign(new Error("duplicate audit event"), { name: "ConditionalCheckFailedException" });
      }
      this.items.set(key, structuredClone(item));
      return {};
    }
    if (command instanceof QueryCommand) {
      this.commands.push(command);
      const pk = String(command.input.ExpressionAttributeValues?.[":pk"]);
      const Items = [...this.items.values()]
        .filter((item) => item.pk === pk)
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
        .map((item) => structuredClone(item));
      return { Items };
    }
    throw new Error(`unsupported DynamoDB command ${command.constructor.name}`);
  }
}

const config: AwsDynamoDbConfig = { tableName: "automation-state", automationRunsIndexName: "gsi1" };
const event = (eventId = "event-1", tenantId = "tenant-1"): HumanResumeAuditEvent => ({
  eventId,
  occurredAt: "2026-08-19T01:00:00.000Z",
  type: "EXECUTION_STARTED",
  tenantId,
  userId: "user-1",
  runId: "run-1",
  nodeId: "human-1",
  resolutionId: "resolution-1",
});

describe("AwsDynamoHumanResumeAuditStore", () => {
  it("persists and lists append-only events in run order", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeAuditStore(client, config);

    await store.append(event("event-1"));
    await store.append({ ...event("event-2"), occurredAt: "2026-08-19T01:00:01.000Z", type: "EXECUTION_SUCCEEDED" });

    const events = await store.listForRun({ tenantId: "tenant-1", userId: "user-1" }, "run-1");
    expect(events.map((value) => value.type)).toEqual(["EXECUTION_STARTED", "EXECUTION_SUCCEEDED"]);
    const put = client.commands[0];
    expect(put).toBeInstanceOf(PutCommand);
    if (!(put instanceof PutCommand)) throw new Error("expected PutCommand");
    expect(put.input.ConditionExpression).toContain("attribute_not_exists");
    const query = client.commands.at(-1);
    expect(query).toBeInstanceOf(QueryCommand);
    if (!(query instanceof QueryCommand)) throw new Error("expected QueryCommand");
    expect(query.input.ConsistentRead).toBe(true);
  });

  it("isolates audit history by tenant ownership partition", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeAuditStore(client, config);
    await store.append(event("event-1", "tenant-1"));
    await store.append(event("event-2", "tenant-2"));

    expect(await store.listForRun({ tenantId: "tenant-1", userId: "user-1" }, "run-1")).toHaveLength(1);
    expect(await store.listForRun({ tenantId: "tenant-2", userId: "user-1" }, "run-1")).toHaveLength(1);
  });

  it("does not overwrite a duplicate event id at the same timestamp", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResumeAuditStore(client, config);
    await store.append(event());
    await expect(store.append(event())).rejects.toThrow("duplicate audit event");
  });
});
