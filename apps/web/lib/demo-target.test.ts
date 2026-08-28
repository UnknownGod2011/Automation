import { afterEach, describe, expect, it } from "vitest";
import {
  demoTargetCompletedHtml,
  demoTargetSessionCookie,
  hasDemoTargetSession,
  isValidDemoConfirmation,
  isValidDemoMode,
  isValidDemoPriority,
  readDemoTargetConfig,
} from "./demo-target";
import { GET as getDemoTarget } from "../app/demo-target/route";
import { POST as loginDemoTarget } from "../app/demo-target/login/route";
import { POST as runDemoAction } from "../app/demo-target/action/route";

const originalEnabled = process.env.AUTOMATION_DEMO_TARGET_ENABLED;
const originalTtl = process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS;
const originalSemanticDrift = process.env.AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.AUTOMATION_DEMO_TARGET_ENABLED;
  else process.env.AUTOMATION_DEMO_TARGET_ENABLED = originalEnabled;
  if (originalTtl === undefined) delete process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS;
  else process.env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS = originalTtl;
  if (originalSemanticDrift === undefined) delete process.env.AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED;
  else process.env.AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED = originalSemanticDrift;
});

describe("controlled demo target", () => {
  it("is disabled by default and bounds demo configuration", () => {
    expect(readDemoTargetConfig({})).toEqual({
      enabled: false,
      sessionTtlSeconds: 900,
      semanticDriftEnabled: false,
    });
    expect(readDemoTargetConfig({
      AUTOMATION_DEMO_TARGET_ENABLED: "true",
      AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "600",
      AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED: "true",
    })).toEqual({ enabled: true, sessionTtlSeconds: 600, semanticDriftEnabled: true });
    expect(() => readDemoTargetConfig({
      AUTOMATION_DEMO_TARGET_ENABLED: "true",
      AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "30",
    })).toThrow("configuration");
    expect(() => readDemoTargetConfig({
      AUTOMATION_DEMO_TARGET_ENABLED: "true",
      AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS: "not-a-number",
    })).toThrow("configuration");
    expect(() => readDemoTargetConfig({
      AUTOMATION_DEMO_TARGET_ENABLED: "true",
      AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED: "yes",
    })).toThrow("configuration");
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

  it("accepts only the closed non-secret demo priority, radio mode, and confirmation values", () => {
    expect(isValidDemoPriority("low")).toBe(true);
    expect(isValidDemoPriority("normal")).toBe(true);
    expect(isValidDemoPriority("high")).toBe(true);
    expect(isValidDemoPriority("urgent")).toBe(false);
    expect(isValidDemoPriority(null)).toBe(false);
    expect(isValidDemoMode("focused")).toBe(true);
    expect(isValidDemoMode("standard")).toBe(false);
    expect(isValidDemoMode("forged")).toBe(false);
    expect(isValidDemoMode(null)).toBe(false);
    expect(isValidDemoConfirmation("confirmed")).toBe(true);
    expect(isValidDemoConfirmation("on")).toBe(false);
    expect(isValidDemoConfirmation(null)).toBe(false);
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

  it("presents a repeatable select + radio + text + checkbox + submit workflow only with a live demo session", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    delete process.env.AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED;
    const response = await getDemoTarget(new Request("https://demo.example/demo-target", {
      headers: { cookie: "automation_demo_auth=authenticated" },
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-testid="demo-priority"');
    expect(body).toContain('<option value="high">High priority</option>');
    expect(body).toContain('data-testid="demo-mode-standard"');
    expect(body).toContain('data-testid="demo-mode-focused"');
    expect(body).toContain('type="radio"');
    expect(body).toContain('value="standard"');
    expect(body).toContain('value="focused"');
    expect(body).toContain('data-testid="demo-note"');
    expect(body).toContain('type="checkbox"');
    expect(body).toContain('data-testid="demo-confirm"');
    expect(body).toContain('data-testid="demo-submit"');
    expect(body).not.toContain('data-testid="demo-semantic-submit"');
    expect(body).not.toContain("password");
    expect(body).not.toContain("api key");
  });

  it("can opt into a harmless submit-target drift without changing the form side effect", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    process.env.AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED = "true";
    const response = await getDemoTarget(new Request("https://demo.example/demo-target", {
      headers: { cookie: "automation_demo_auth=authenticated" },
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="demo-form"');
    expect(body).not.toContain('data-testid="demo-submit"');
    expect(body).toContain('data-testid="demo-semantic-submit-slot"');
    expect(body).toContain('data-testid="demo-semantic-submit"');
    expect(body).toContain('type="submit"');
    expect(body).toContain('form="demo-form"');
    expect(body).toContain('aria-label="Finish controlled demo after selector drift"');
    expect(body).not.toContain("password");
    expect(body).not.toContain("api key");
  });

  it("accepts only the controlled inputs and never reflects submitted demo values", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const secretLookingNote = "do-not-render-this-demo-value";
    const form = new FormData();
    form.set("priority", "high");
    form.set("mode", "focused");
    form.set("note", secretLookingNote);
    form.set("confirm", "confirmed");
    const response = await runDemoAction(new Request("https://demo.example/demo-target/action", {
      method: "POST",
      headers: { cookie: "automation_demo_auth=authenticated" },
      body: form,
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-testid="demo-complete"');
    expect(body).not.toContain(secretLookingNote);
    expect(body).not.toContain("High priority");
    expect(body).not.toContain("Focused handling");
    expect(body).not.toContain("focused");
    expect(body).not.toContain("confirmed");
    expect(demoTargetCompletedHtml()).not.toContain(secretLookingNote);
  });

  it("rejects missing or forged demo priority/mode/confirmation before reporting completion", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    for (const [priority, mode, confirmation] of [
      [null, "focused", "confirmed"],
      ["urgent", "focused", "confirmed"],
      ["normal", null, "confirmed"],
      ["normal", "standard", "confirmed"],
      ["normal", "forged", "confirmed"],
      ["normal", "focused", null],
      ["normal", "focused", "forged"],
    ] as const) {
      const form = new FormData();
      if (priority !== null) form.set("priority", priority);
      if (mode !== null) form.set("mode", mode);
      form.set("note", "safe demo note");
      if (confirmation !== null) form.set("confirm", confirmation);
      const response = await runDemoAction(new Request("https://demo.example/demo-target/action", {
        method: "POST",
        headers: { cookie: "automation_demo_auth=authenticated" },
        body: form,
      }));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('data-testid="demo-complete"');
    }
  });

  it("returns 401 after the browser no longer sends the expired auth cookie", async () => {
    process.env.AUTOMATION_DEMO_TARGET_ENABLED = "true";
    const form = new FormData();
    form.set("priority", "normal");
    form.set("mode", "focused");
    form.set("note", "safe demo note");
    form.set("confirm", "confirmed");
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
