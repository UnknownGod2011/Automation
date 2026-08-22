import { describe, expect, it } from "vitest";
import { normalizeAutomationTargetUrl } from "./target-url-policy.js";

describe("normalizeAutomationTargetUrl", () => {
  it("accepts and normalizes public HTTP(S) targets", () => {
    expect(normalizeAutomationTargetUrl("https://Example.COM/path?q=1")).toBe("https://example.com/path?q=1");
    expect(normalizeAutomationTargetUrl("https://8.8.8.8/")).toBe("https://8.8.8.8/");
    expect(normalizeAutomationTargetUrl("https://[2606:4700:4700::1111]/")).toBe("https://[2606:4700:4700::1111]/");
    expect(normalizeAutomationTargetUrl("https://example.test/app")).toBe("https://example.test/app");
  });

  it("rejects non-browser protocols and embedded credentials", () => {
    expect(() => normalizeAutomationTargetUrl("file:///etc/passwd")).toThrow("HTTP(S)");
    expect(() => normalizeAutomationTargetUrl("ftp://example.com/file")).toThrow("HTTP(S)");
    expect(() => normalizeAutomationTargetUrl("https://user:secret@example.com/")).toThrow("embedded credentials");
  });

  it.each([
    "http://localhost:3000/",
    "http://api.localhost/",
    "http://router.local/",
    "http://service.home.arpa/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://intranet/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://100.64.0.1/",
    "http://127.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/",
    "http://192.0.2.1/",
    "http://192.168.1.1/",
    "http://198.18.0.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[2001:db8::1]/",
    "http://[ff02::1]/",
  ])("rejects non-public cloud-browser target %s", (target) => {
    expect(() => normalizeAutomationTargetUrl(target)).toThrow("public network host");
  });
});
