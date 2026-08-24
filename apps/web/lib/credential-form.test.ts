import { describe, expect, it } from "vitest";
import { parseWebByokProvider, WEB_BYOK_PROVIDER_OPTIONS } from "./credential-form";

describe("web BYOK provider boundary", () => {
  it("exposes only providers backed by the deployed web product", () => {
    expect(WEB_BYOK_PROVIDER_OPTIONS).toEqual([{ value: "openai", label: "OpenAI" }]);
  });

  it("normalizes OpenAI and rejects unsupported provider identifiers", () => {
    expect(parseWebByokProvider(" openai ")).toBe("openai");
    expect(parseWebByokProvider("OPENAI")).toBe("openai");
    expect(parseWebByokProvider("google")).toBeUndefined();
    expect(parseWebByokProvider("anthropic")).toBeUndefined();
    expect(parseWebByokProvider("")).toBeUndefined();
    expect(parseWebByokProvider(null)).toBeUndefined();
  });
});
