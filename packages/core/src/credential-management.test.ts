import { describe, expect, it, vi } from "vitest";
import {
  AutomationControlPlaneHttpHandler,
  AutomationControlPlaneService,
  InMemoryCredentialMetadataRepository,
  InMemoryCredentialVault,
  ProviderCredentialManagementService,
  type CredentialVault,
  type OwnershipScope,
} from "./index.js";

const scope: OwnershipScope = { tenantId: "tenant-a", userId: "user-a" };
const otherScope: OwnershipScope = { tenantId: "tenant-b", userId: "user-b" };

function management() {
  const vault = new InMemoryCredentialVault();
  const metadata = new InMemoryCredentialMetadataRepository();
  return {
    vault,
    metadata,
    service: new ProviderCredentialManagementService(vault, metadata),
  };
}

describe("ProviderCredentialManagementService", () => {
  it("creates and lists only sanitized tenant-scoped credential metadata", async () => {
    const { service } = management();
    const created = await service.create({
      scope,
      credentialId: "cred-1",
      provider: "OpenAI",
      apiKey: "sk-super-secret",
      maskedLabel: "Personal OpenAI key",
      priority: 5,
    });

    expect(created).toEqual({
      credentialId: "cred-1",
      provider: "openai",
      maskedLabel: "Personal OpenAI key",
      status: "UNKNOWN",
      priority: 5,
      failureCount: 0,
    });
    expect(JSON.stringify(created)).not.toContain("sk-super-secret");
    expect(JSON.stringify(created)).not.toContain("secretRef");
    await expect(service.list(scope)).resolves.toEqual([created]);
    await expect(service.list(otherScope)).resolves.toEqual([]);
    await expect(
      service.create({
        scope,
        credentialId: "cred-1",
        provider: "openai",
        apiKey: "replacement",
        maskedLabel: "duplicate",
        priority: 10,
      }),
    ).rejects.toThrow("credential already exists");
  });

  it("rotates through the stable vault reference and resets stale health state", async () => {
    const { service, metadata, vault } = management();
    await service.create({
      scope,
      credentialId: "cred-1",
      provider: "openai",
      apiKey: "old-key",
      maskedLabel: "OpenAI",
      priority: 1,
    });
    const stored = await metadata.get(scope, "cred-1");
    if (!stored) throw new Error("credential setup failed");
    await metadata.put({
      ...stored,
      status: "COOLDOWN",
      cooldownUntil: "2026-08-20T03:00:00.000Z",
      lastSuccessAt: "2026-08-20T01:00:00.000Z",
      failureCount: 4,
    });

    const rotated = await service.rotate({
      scope,
      credentialId: "cred-1",
      apiKey: "new-key",
    });

    expect(rotated).toEqual({
      credentialId: "cred-1",
      provider: "openai",
      maskedLabel: "OpenAI",
      status: "UNKNOWN",
      priority: 1,
      failureCount: 0,
    });
    expect(await vault.get(scope, stored.secretRef)).toEqual({ value: "new-key" });
    const after = await metadata.get(scope, "cred-1");
    expect(after?.cooldownUntil).toBeUndefined();
    expect(after?.lastSuccessAt).toBeUndefined();
  });

  it("revokes the secret before deleting metadata and is idempotent after removal", async () => {
    const events: string[] = [];
    const metadata = new InMemoryCredentialMetadataRepository();
    const memoryVault = new InMemoryCredentialVault();
    const vault: CredentialVault = {
      put: async (...args) => memoryVault.put(...args),
      get: async (...args) => memoryVault.get(...args),
      delete: async (...args) => {
        events.push("secret");
        await memoryVault.delete(...args);
      },
    };
    const originalDelete = metadata.delete.bind(metadata);
    metadata.delete = async (...args) => {
      events.push("metadata");
      await originalDelete(...args);
    };
    const service = new ProviderCredentialManagementService(vault, metadata);
    await service.create({
      scope,
      credentialId: "cred-1",
      provider: "openai",
      apiKey: "secret",
      maskedLabel: "OpenAI",
      priority: 0,
    });

    await expect(service.remove(otherScope, "cred-1")).resolves.toBe(false);
    await expect(service.remove(scope, "cred-1")).resolves.toBe(true);
    expect(events).toEqual(["secret", "metadata"]);
    await expect(service.remove(scope, "cred-1")).resolves.toBe(false);
  });

  it("rejects a vault that changes the secret reference during rotation", async () => {
    const metadata = new InMemoryCredentialMetadataRepository();
    await metadata.put({
      tenantId: scope.tenantId,
      userId: scope.userId,
      credentialId: "cred-1",
      provider: "openai",
      secretRef: "stable-ref",
      maskedLabel: "OpenAI",
      status: "HEALTHY",
      priority: 0,
      failureCount: 0,
    });
    const cleanup = vi.fn(async () => undefined);
    const vault: CredentialVault = {
      put: vi.fn(async () => "new-ref"),
      get: vi.fn(async () => null),
      delete: cleanup,
    };
    const service = new ProviderCredentialManagementService(vault, metadata);

    await expect(
      service.rotate({ scope, credentialId: "cred-1", apiKey: "new-key" }),
    ).rejects.toThrow("stable-reference rotation");
    expect(cleanup).toHaveBeenCalledWith(scope, "new-ref");
    expect((await metadata.get(scope, "cred-1"))?.secretRef).toBe("stable-ref");
  });
});

describe("credential control-plane HTTP boundary", () => {
  it("uses authenticated scope and never returns submitted API keys or secret refs", async () => {
    const { service: credentials } = management();
    const controlPlane = new AutomationControlPlaneService({
      automations: {} as never,
      runs: {} as never,
      lifecycle: {} as never,
      captureSessions: {} as never,
      captureState: {} as never,
      capabilities: {
        auth: "LOCAL_MOCK",
        capture: "LOCAL_MOCK",
        cloudExecution: "LOCAL_MOCK",
        scheduling: "LOCAL_MOCK",
        notifications: "LOCAL_MOCK",
      },
      credentials,
    });
    const handler = new AutomationControlPlaneHttpHandler(controlPlane);

    const created = await handler.handle(
      {
        method: "POST",
        path: "/v1/credentials",
        body: {
          tenantId: "spoofed-tenant",
          userId: "spoofed-user",
          credentialId: "cred-1",
          provider: "openai",
          apiKey: "top-secret",
          maskedLabel: "OpenAI",
          priority: 0,
        },
      },
      { scope },
    );
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain("top-secret");
    expect(JSON.stringify(created.body)).not.toContain("secretRef");

    const ownerList = await handler.handle(
      { method: "GET", path: "/v1/credentials" },
      { scope },
    );
    expect(ownerList.body).toMatchObject({ credentials: [{ credentialId: "cred-1" }] });

    const otherList = await handler.handle(
      { method: "GET", path: "/v1/credentials" },
      { scope: otherScope },
    );
    expect(otherList.body).toEqual({ credentials: [] });

    const rotated = await handler.handle(
      {
        method: "POST",
        path: "/v1/credentials/cred-1/rotate",
        body: { apiKey: "rotated-secret" },
      },
      { scope },
    );
    expect(rotated.status).toBe(200);
    expect(JSON.stringify(rotated.body)).not.toContain("rotated-secret");

    const removed = await handler.handle(
      { method: "POST", path: "/v1/credentials/cred-1/remove", body: {} },
      { scope },
    );
    expect(removed).toEqual({ status: 200, body: { removed: true } });
  });
});