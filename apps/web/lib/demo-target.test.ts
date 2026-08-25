import { afterEach, describe, expect, it } from "vitest";
import {
  demoTargetCompletedHtml,
  demoTargetSessionCookie,
  hasDemoTargetSession,
  readDemoTargetConfig,
} from "./demo-target";
import { GET as getDemoTarget } from "../app/demo-target/route";
import { POST as loginDemoTarget } from "../app/demo-target/login/route";
import { POST as runDemoAction } from "../app/demo-target/action/route";

const originalEnabled = process.env.AUTOMATION_DEMO_TARGET_ENABLED;
const originalTtl = process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.AUTOMATION_DEMO_TARGET_ENABLED;
  else process.env.AUTOMATION_DEMO_TARGET_ENABLED = originalEnabled;
  if (originalTtl === undefined) delete process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS;
  else process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS = originalTtl;
});

describe("controlled demo target", () => {
  it("is disabled by default and bounds session TTL configuration", () => {
    expect(readDemoTargetConfig({})).toEqual({ enabled: false, sessionTtlSeconds: 900 });
    expect(readDemoTargetConfig({ AUTOMATION_DEMO_TARGET_ENABLED: "true", AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "600" })).toEqual({ enabled: true, sessionTtlSeconds: 600 });
    expect(() => readDemoTargetConfig({ AUTOMATION_DEMO_TARGET_ENABLED: "true", AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "30" })).toThrow("configuration");
    expect(() => readDemoTargetConfig({ AUTOMATION_DEMO_TARGET_ENABLED: "true", AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "not-a-number" })).toThrow("configuration");
  });

  it("uses a scoped HttpOnly Secure authentication cookie", () => {
    const cookie = demoTargetSessionCookie(600);
    expect(cookie).toContain("automation_demo_auth=authenticated");
    expect(cookie).toContain("Path=/demo-target");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(hasDemoTargetSession("other=1; automation_demo_auth=authenticated")).toBe(true);
    expect(hasDemoTargetSession("automation_demo_auth=forged")).toBe(false);
  });

  it("returns 404 while disabled and 401 auth setup before the demo session exists", async () => {
    delete process.env.AUTOMATION_DEMO_TARGET_ENABLED;
    const disabled = await getDemoTarget(new Request("https://demo.example/demo-target"));
    expect(disabled.status).toBe(404);

    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const response = await getDemoTarget(new Request("https://demo.example/demo-target"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain('data-testid="demo-login"');
  });

  it("signs into the harmless target without exposing any credential material", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS = "600";
    const response = await loginDemoTarget(new Request("https://demo.example/demo-target/login", { method: "POST" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://demo.example/demo-target");
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).not.toContain("token");
    expect(cookie).not.toContain("secret");
  });

  it("presents a repeatable workflow only with a live demo session", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const response = await getDemoTarget(new Request("https://demo.example/demo-target", {
      headers: { cookie: "automation_demo_auth=authenticated" },
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-testid="demo-note"');
    expect(body).toContain('data-testid="demo-submit"');
    expect(body).not.toContain("password");
    expect(body).not.toContain("api key");
  });

  it("never reflects typed demo input into the post-action page", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const secretLookingNote = "do-not-render-this-demo-value";
    const form = new FormData();
    form.set("note", secretLookingNote);
    const response = await runDemoAction(new Request("https://demo.example/demo-target/action", {
      method: "POST",
      headers: { cookie: "automation_demo_auth=authenticated" },
      body: form,
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-testid="demo-complete"');
    expect(body).not.toContain(secretLookingNote);
    expect(demoTargetCompletedHtml()).not.toContain(secretLookingNote);
  });

  it("returns 401 after the browser no longer sends the expired auth cookie", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const form = new FormData();
    form.set("note", "safe demo note");
    const response = await runDemoAction(new Request("https://demo.example/demo-target/action", {
      method: "POST",
      body: form,
    }));
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('data-testid="demo-login"');
  });

  it("fails closed when enabled with invalid TTL configuration", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS = "5";
    const response = await getDemoTarget(new Request("https://demo.example/demo-target"));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Demo target is not configured");
  });
});
