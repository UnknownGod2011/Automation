import { describe, expect, it } from "vitest";
import {
  AgentCoreIdentityCredentialVault,
  parseAgentCoreSecretRef,
  type AgentCoreApiKeyControlApi,
  type AgentCoreApiKeyDataApi,
} from "./index.js";

class FakeControlApi implements AgentCoreApiKeyControlApi {
  readonly creates: { name: string; apiKey: string; tags: Readonly<Record<string, string>> }[] = [];
  readonly updates: { name: string; apiKey: string }[] = [];
  readonly deletes: string[] = [];
  createError: unknown;
  deleteError: unknown;

  async create(name: string, apiKey: string, tags: Readonly<Record<string, string>>) {
    this.creates.push({ name, apiKey, tags: structuredClone(tags) });
    if (this.createError) throw this.createError;
  }

  async update(name: string, apiKey: string) {
    this.updates.push({ name, apiKey });
  }

  async delete(name: string) {
    this.deletes.push(name);
    if (this.deleteError) throw this.deleteError;
  }
}

class FakeDataApi implements AgentCoreApiKeyDataApi {
  readonly gets: { providerName: string; executionIdentityToken: string }[] = [];
  value = "provider-secret";
  error: unknown;

  async get(providerName: string, executionIdentityToken: string) {
    this.gets.push({ providerName, executionIdentityToken });
    if (this.error) throw this.error;
    return this.value;
  }
}

const scope = { tenantId: "tenant-1", userId: "user-1" };

function vault() {
  const control = new FakeControlApi();
  const data = new FakeDataApi();
  return {
    control,
    data,
    value: new AgentCoreIdentityCredentialVault(control, data),
  };
}

describe("AgentCoreIdentityCredentialVault", () => {
  it("stores raw BYOK material only through AgentCore Identity and returns an opaque scoped ref", async () => {
    const { value, control } = vault();
    const ref = await value.put(scope, "cred-1", { value: "raw-api-key" });

    expect(ref).toMatch(/^aws-agentcore-api-key:\/\//);
    expect(ref).not.toContain(scope.tenantId);
    expect(ref).not.toContain(scope.userId);
    expect(ref).not.toContain("raw-api-key");
    expect(control.creates).toHaveLength(1);
    expect(control.creates[0]?.apiKey).toBe("raw-api-key");
    expect(JSON.stringify(control.creates[0]?.tags)).not.toContain(scope.tenantId);
    expect(JSON.stringify(control.creates[0]?.tags)).not.toContain(scope.userId);
  });

  it("updates the same scoped provider when the control plane reports a create conflict", async () => {
    const { value, control } = vault();
    control.createError = Object.assign(new Error("exists"), { name: "ConflictException" });

    await value.put(scope, "cred-1", { value: "new-api-key" });
    expect(control.updates).toHaveLength(1);
    expect(control.updates[0]?.apiKey).toBe("new-api-key");
    expect(control.updates[0]?.name).toBe(control.creates[0]?.name);
  });

  it("requires the runtime execution identity token before retrieving a secret", async () => {
    const { value, data } = vault();
    const ref = await value.put(scope, "cred-1", { value: "raw-api-key" });

    await expect(value.get(scope, ref)).rejects.toMatchObject({
      failure: { code: "NOT_CONFIGURED" },
    });
    expect(data.gets).toHaveLength(0);

    await expect(
      value.get(scope, ref, { executionIdentityToken: "workload-token" }),
    ).resolves.toEqual({ value: "provider-secret" });
    expect(data.gets[0]?.executionIdentityToken).toBe("workload-token");
  });

  it("rejects cross-tenant secret references before requesting AgentCore Identity", async () => {
    const { value, data } = vault();
    const ref = await value.put(scope, "cred-1", { value: "raw-api-key" });

    await expect(
      value.get(
        { tenantId: "tenant-2", userId: "user-2" },
        ref,
        { executionIdentityToken: "workload-token" },
      ),
    ).rejects.toThrow(/outside the authorized ownership scope/);
    expect(data.gets).toHaveLength(0);
  });

  it("returns null for a deleted provider and treats delete not-found as idempotent", async () => {
    const { value, control, data } = vault();
    const ref = await value.put(scope, "cred-1", { value: "raw-api-key" });
    data.error = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    await expect(
      value.get(scope, ref, { executionIdentityToken: "workload-token" }),
    ).resolves.toBeNull();

    control.deleteError = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    await expect(value.delete(scope, ref)).resolves.toBeUndefined();
  });

  it("rejects foreign adapter refs", () => {
    expect(() => parseAgentCoreSecretRef(scope, "gcp-secret://cred-1")).toThrow(/does not belong/);
  });
});
