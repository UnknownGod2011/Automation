import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ProviderCredentialMetadata } from "@automation/contracts";
import { describe, expect, it } from "vitest";
import {
  AwsDynamoCredentialMetadataRepository,
  type AwsDynamoDbConfig,
  type DynamoDocumentClientLike,
} from "./index.js";

function keyOf(item: Record<string, unknown>): string {
  return `${String(item.pk)}|${String(item.sk)}`;
}

class FakeDynamo implements DynamoDocumentClientLike {
  readonly items = new Map<string, Record<string, unknown>>();

  async send(command: Parameters<DynamoDocumentClientLike["send"]>[0]): Promise<Record<string, unknown>> {
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      this.items.set(keyOf(item), structuredClone(item));
      return {};
    }
    if (command instanceof GetCommand) {
      const key = command.input.Key as Record<string, unknown>;
      const item = this.items.get(keyOf(key));
      return item ? { Item: structuredClone(item) } : {};
    }
    if (command instanceof QueryCommand) {
      const values = command.input.ExpressionAttributeValues ?? {};
      return {
        Items: [...this.items.values()]
          .filter(
            (item) =>
              item.pk === values[":pk"] &&
              String(item.sk).startsWith(String(values[":prefix"])),
          )
          .map((item) => structuredClone(item)),
      };
    }
    if (command instanceof DeleteCommand) {
      const key = command.input.Key as Record<string, unknown>;
      this.items.delete(keyOf(key));
      return {};
    }
    throw new Error(`unsupported command ${command.constructor.name}`);
  }
}

const config: AwsDynamoDbConfig = {
  tableName: "automation-state",
  automationRunsIndexName: "gsi1",
};
const scope = { tenantId: "tenant-1", userId: "user-1" };
const otherScope = { tenantId: "tenant-2", userId: "user-2" };

function credential(id: string, priority = 0): ProviderCredentialMetadata {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    credentialId: id,
    provider: "openai",
    secretRef: `aws-agentcore-api-key://${id}`,
    maskedLabel: id,
    status: "UNKNOWN",
    priority,
    failureCount: 0,
  };
}

describe("AwsDynamoCredentialMetadataRepository", () => {
  it("persists, lists, and deletes credentials inside the owning tenant scope", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoCredentialMetadataRepository(client, config);
    await repository.put(credential("later", 10));
    await repository.put(credential("first", 0));

    await expect(repository.get(scope, "first")).resolves.toMatchObject({
      credentialId: "first",
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    await expect(repository.get(otherScope, "first")).resolves.toBeNull();
    await expect(repository.list(scope)).resolves.toMatchObject([
      { credentialId: "first" },
      { credentialId: "later" },
    ]);
    await expect(repository.list(otherScope)).resolves.toEqual([]);

    await repository.delete(otherScope, "first");
    await expect(repository.get(scope, "first")).resolves.not.toBeNull();
    await repository.delete(scope, "first");
    await expect(repository.get(scope, "first")).resolves.toBeNull();
  });

  it("rejects corrupted embedded ownership instead of returning cross-tenant metadata", async () => {
    const client = new FakeDynamo();
    const repository = new AwsDynamoCredentialMetadataRepository(client, config);
    await repository.put(credential("cred-1"));
    const item = [...client.items.values()][0];
    if (!item) throw new Error("test item was not written");
    item.record = {
      ...(item.record as ProviderCredentialMetadata),
      tenantId: "attacker-tenant",
    };

    await expect(repository.get(scope, "cred-1")).rejects.toThrow(
      "ownership does not match",
    );
  });
});