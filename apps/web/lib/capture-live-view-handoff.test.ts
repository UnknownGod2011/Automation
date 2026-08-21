import { describe, expect, it } from "vitest";
import { createCaptureLiveViewHandoff } from "./capture-live-view-handoff";

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
