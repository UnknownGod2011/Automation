import { describe, expect, it } from "vitest";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  AwsDynamoHumanResolutionClaimStore,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";

function conditionalError(): Error {
  return Object.assign(new Error("conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });
}

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();
  readonly commands: Array<GetCommand | PutCommand> = [];

  async send(
    command: Parameters<DynamoDocumentClientLike["send"]>[0],
  ): Promise<Record<string, unknown>> {
    if (command instanceof PutCommand) {
      this.commands.push(command);
      const item = command.input.Item as Record<string, unknown>;
      const key = keyOf(item);
      if (
        command.input.ConditionExpression?.includes("attribute_not_exists") &&
        this.items.has(key)
      ) {
        throw conditionalError();
      }
      this.items.set(key, structuredClone(item));
      return {};
    }

    if (command instanceof GetCommand) {
      this.commands.push(command);
      const key = command.input.Key as Record<string, unknown>;
      const item = this.items.get(keyOf(key));
      return item ? { Item: structuredClone(item) } : {};
    }

    throw new Error(`unsupported DynamoDB command ${command.constructor.name}`);
  }
}

const config: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};
const scope = { tenantId: "tenant-1", userId: "user-1" };

function command(resolutionId: string) {
  return {
    scope,
    runId: "run-1",
    expectedNodeId: "human-1",
    resolutionId,
  };
}

describe("AwsDynamoHumanResolutionClaimStore", () => {
  it("accepts the first resolution with a conditional write", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResolutionClaimStore(client, config);

    const result = await store.claim(
      command("resolution-1"),
      "2026-08-19T00:00:00.000Z",
    );

    expect(result).toMatchObject({
      status: "ACCEPTED",
      claim: {
        tenantId: "tenant-1",
        userId: "user-1",
        runId: "run-1",
        nodeId: "human-1",
        resolutionId: "resolution-1",
      },
    });
    const put = client.commands[0];
    expect(put).toBeInstanceOf(PutCommand);
    if (!(put instanceof PutCommand)) throw new Error("expected PutCommand");
    expect(put.input.ConditionExpression).toContain("attribute_not_exists");
  });

  it("returns REPLAY for duplicate delivery of the winning resolution", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResolutionClaimStore(client, config);

    await store.claim(command("resolution-1"), "2026-08-19T00:00:00.000Z");
    const replay = await store.claim(
      command("resolution-1"),
      "2026-08-19T00:00:01.000Z",
    );

    expect(replay.status).toBe("REPLAY");
    expect(replay.claim.acceptedAt).toBe("2026-08-19T00:00:00.000Z");
    const read = client.commands.at(-1);
    expect(read).toBeInstanceOf(GetCommand);
    if (!(read instanceof GetCommand)) throw new Error("expected GetCommand");
    expect(read.input.ConsistentRead).toBe(true);
  });

  it("returns CONFLICT when a competing resolution id loses the same pause boundary", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResolutionClaimStore(client, config);

    const [first, second] = await Promise.all([
      store.claim(command("resolution-1"), "2026-08-19T00:00:00.000Z"),
      store.claim(command("resolution-2"), "2026-08-19T00:00:00.000Z"),
    ]);

    expect([first.status, second.status].sort()).toEqual(["ACCEPTED", "CONFLICT"]);
    expect(first.claim.resolutionId).toBe(second.claim.resolutionId);
  });

  it("isolates claims by tenant and user ownership partition", async () => {
    const client = new FakeDynamo();
    const store = new AwsDynamoHumanResolutionClaimStore(client, config);

    await store.claim(command("resolution-1"), "2026-08-19T00:00:00.000Z");

    expect(
      await store.get(
        { tenantId: "tenant-2", userId: "user-2" },
        "run-1",
        "human-1",
      ),
    ).toBeNull();
    expect(await store.get(scope, "run-1", "human-1")).toMatchObject({
      resolutionId: "resolution-1",
    });
  });

  it("does not convert non-conditional DynamoDB failures into duplicate outcomes", async () => {
    const failing: DynamoDocumentClientLike = {
      async send() {
        throw Object.assign(new Error("throttled"), {
          name: "ProvisionedThroughputExceededException",
        });
      },
    };
    const store = new AwsDynamoHumanResolutionClaimStore(failing, config);

    await expect(
      store.claim(command("resolution-1"), "2026-08-19T00:00:00.000Z"),
    ).rejects.toThrow(/throttled/);
  });
});
