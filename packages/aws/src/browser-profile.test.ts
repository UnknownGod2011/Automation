import { describe, expect, it } from "vitest";
import {
  AgentCoreBrowserProfileStore,
  parseProfileRef,
  profileRef,
  type AgentCoreBrowserProfileApi,
} from "./index.js";

const scope = { tenantId: "tenant-1", userId: "user-1" };
const profileId = "automation_profile-1234567890";

class FakeProfileApi implements AgentCoreBrowserProfileApi {
  readonly creates: Parameters<AgentCoreBrowserProfileApi["create"]>[0][] = [];
  getError: unknown;
  deleteError: unknown;

  async create(input: Parameters<AgentCoreBrowserProfileApi["create"]>[0]) {
    this.creates.push(structuredClone(input));
    return { profileId };
  }

  async get() {
    if (this.getError) throw this.getError;
  }

  async delete() {
    if (this.deleteError) throw this.deleteError;
  }
}

describe("AgentCoreBrowserProfileStore", () => {
  it("creates stable opaque profile references without putting ownership data in tags", async () => {
    const api = new FakeProfileApi();
    const store = new AgentCoreBrowserProfileStore(api);

    const first = await store.create(scope, "auto-1");
    const second = await store.create(scope, "auto-1");

    expect(first).toBe(`aws-agentcore-browser-profile://${profileId}`);
    expect(second).toBe(first);
    expect(api.creates[0]?.clientToken.length).toBeGreaterThanOrEqual(33);
    expect(api.creates[1]?.clientToken).toBe(api.creates[0]?.clientToken);
    expect(JSON.stringify(api.creates[0]?.tags)).not.toContain(scope.tenantId);
    expect(JSON.stringify(api.creates[0]?.tags)).not.toContain(scope.userId);
  });

  it("returns false only for a service not-found error", async () => {
    const api = new FakeProfileApi();
    const store = new AgentCoreBrowserProfileStore(api);
    api.getError = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    expect(await store.exists(scope, profileRef(profileId))).toBe(false);

    api.getError = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    await expect(store.exists(scope, profileRef(profileId))).rejects.toThrow(/denied/);
  });

  it("rejects foreign or malformed profile references before making cloud calls", () => {
    expect(() => parseProfileRef("gcp-browser-profile://abc")).toThrow(/does not belong/);
    expect(() => parseProfileRef("aws-agentcore-browser-profile://bad/id")).toThrow(/invalid/);
  });

  it("treats delete of an already-missing profile as idempotent", async () => {
    const api = new FakeProfileApi();
    const store = new AgentCoreBrowserProfileStore(api);
    api.deleteError = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    await expect(store.delete(scope, profileRef(profileId))).resolves.toBeUndefined();
  });
});
