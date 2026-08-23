import { describe, expect, it } from "vitest";
import {
  createCaptureLiveViewHandoff,
  createHumanTakeoverLiveViewHandoff,
} from "./capture-live-view-handoff";

describe("capture Live View handoff", () => {
  it("keeps the Live View capability in a non-cacheable response body instead of a redirect", async () => {
    const capability = "https://live.example.com/session?token=secret-token&mode=capture";
    const response = createCaptureLiveViewHandoff("automation/one", capability);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");

    for (const value of response.headers.values()) {
      expect(value).not.toContain("secret-token");
    }

    const html = await response.text();
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("token=secret-token&amp;mode=capture");
    expect(html).toContain("/automations/automation%2Fone");
    expect(html).toContain("Start recording workflow");
  });

  it("rejects unsafe Live View URLs before rendering the capability", () => {
    expect(() => createCaptureLiveViewHandoff("automation-1", "http://live.example.com/session")).toThrow(/HTTPS/);
    expect(() => createCaptureLiveViewHandoff("automation-1", "https://user:password@live.example.com/session")).toThrow(/embedded credentials/);
    expect(() => createCaptureLiveViewHandoff("automation-1", `https://live.example.com/${"x".repeat(8_192)}`)).toThrow(/length/);
  });

  it("requires a server-resolved automation identity for the return path", () => {
    expect(() => createCaptureLiveViewHandoff("   ", "https://live.example.com/session")).toThrow(/automationId/);
  });
});

describe("human takeover Live View handoff", () => {
  it("keeps the repair capability out of redirect headers and returns to the exact run", async () => {
    const capability = "https://live.example.com/repair?token=repair-secret&mode=takeover";
    const response = createHumanTakeoverLiveViewHandoff("automation/one", "run/two", capability);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");

    for (const value of response.headers.values()) {
      expect(value).not.toContain("repair-secret");
    }

    const html = await response.text();
    expect(html).toContain("token=repair-secret&amp;mode=takeover");
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("/automations/automation%2Fone/runs/run%2Ftwo");
    expect(html).toContain("Sign in or complete required MFA yourself");
    expect(html).toContain("Save repaired session &amp; resume");
  });

  it("rejects unsafe repair URLs and missing server-resolved identities", () => {
    expect(() => createHumanTakeoverLiveViewHandoff("automation-1", "run-1", "http://live.example.com/repair")).toThrow(/HTTPS/);
    expect(() => createHumanTakeoverLiveViewHandoff("automation-1", "run-1", "https://user:password@live.example.com/repair")).toThrow(/embedded credentials/);
    expect(() => createHumanTakeoverLiveViewHandoff(" ", "run-1", "https://live.example.com/repair")).toThrow(/automationId/);
    expect(() => createHumanTakeoverLiveViewHandoff("automation-1", " ", "https://live.example.com/repair")).toThrow(/runId/);
  });
});
