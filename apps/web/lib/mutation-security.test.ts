import { describe, expect, it } from "vitest";
import { isSameOriginMutation, safeNotice } from "./mutation-security.js";

describe("web mutation security", () => {
  it("accepts same-origin form posts and rejects cross-origin requests", () => {
    expect(isSameOriginMutation("https://automation.example/api/ui", new Headers({ origin: "https://automation.example" }))).toBe(true);
    expect(isSameOriginMutation("https://automation.example/api/ui", new Headers({ origin: "https://evil.example" }))).toBe(false);
  });

  it("uses Fetch Metadata only as a fallback when Origin is absent", () => {
    expect(isSameOriginMutation("https://automation.example/api/ui", new Headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginMutation("https://automation.example/api/ui", new Headers())).toBe(false);
  });

  it("only reflects fixed notice codes into redirects", () => {
    expect(safeNotice("published")).toBe("published");
    expect(safeNotice("provider-secret=abc")).toBe("request-failed");
  });
});
