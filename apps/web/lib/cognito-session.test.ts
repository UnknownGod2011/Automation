import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  createOAuthTransaction,
  decodeOAuthTransaction,
  encodeOAuthTransaction,
  exchangeAuthorizationCode,
  loadWebCognitoAuthConfig,
  refreshAccessToken,
  sanitizeReturnTo,
  type FetchLike,
} from "./cognito-session.js";

const env = {
  AUTOMATION_COGNITO_DOMAIN: "https://auth.example.test",
  AWS_COGNITO_APP_CLIENT_ID: "client-123",
  AUTOMATION_WEB_ORIGIN: "https://automation.example.test",
};

function config() {
  const loaded = loadWebCognitoAuthConfig(env);
  if (!loaded.configured) throw new Error("expected config");
  return loaded.config;
}

describe("web Cognito session", () => {
  it("fails closed on missing or insecure deployment configuration", () => {
    expect(loadWebCognitoAuthConfig({})).toEqual({
      configured: false,
      missing: ["AUTOMATION_COGNITO_DOMAIN", "AWS_COGNITO_APP_CLIENT_ID", "AUTOMATION_WEB_ORIGIN"],
      reason: "MISSING_CONFIG",
    });
    expect(loadWebCognitoAuthConfig({ ...env, AUTOMATION_COGNITO_DOMAIN: "http://auth.example.test" })).toEqual({
      configured: false,
      missing: [],
      reason: "INVALID_CONFIG",
    });
  });

  it("creates a PKCE authorization request and bounded transaction", () => {
    const { transaction, challenge } = createOAuthTransaction("/automations/demo", 1000);
    const url = buildAuthorizeUrl(config(), transaction, challenge);
    expect(url.origin).toBe("https://auth.example.test");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://automation.example.test/api/auth/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(transaction.verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(transaction.verifier);

    const encoded = encodeOAuthTransaction(transaction);
    expect(decodeOAuthTransaction(encoded, 1000 + 9 * 60 * 1000)).toEqual(transaction);
    expect(decodeOAuthTransaction(encoded, 1000 + 11 * 60 * 1000)).toBeUndefined();
  });

  it("prevents external return redirects and builds an allowlisted Cognito logout", () => {
    expect(sanitizeReturnTo("https://evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("//evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("/automations/demo")).toBe("/automations/demo");
    const logout = buildLogoutUrl(config());
    expect(logout.toString()).toContain("client_id=client-123");
    expect(logout.searchParams.get("logout_uri")).toBe("https://automation.example.test/");
  });

  it("exchanges an authorization code with PKCE without exposing tokens to a URL", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (_input, init) => new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const tokens = await exchangeAuthorizationCode(config(), "code-1", "verifier-1", fetchImpl);
    expect(tokens).toEqual({ accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 3600 });
    const [endpoint, init] = fetchImpl.mock.calls[0]!;
    expect(String(endpoint)).toBe("https://auth.example.test/oauth2/token");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("code_verifier=verifier-1");
    expect(String(endpoint)).not.toContain("code-1");
  });

  it("refreshes an access token and rejects malformed token responses", async () => {
    const goodFetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      access_token: "fresh-access",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(refreshAccessToken(config(), "refresh-1", goodFetch)).resolves.toEqual({
      accessToken: "fresh-access",
      expiresIn: 3600,
    });

    const badFetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({
      access_token: "fresh-access",
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(refreshAccessToken(config(), "refresh-1", badFetch)).rejects.toThrow("COGNITO_TOKEN_RESPONSE_INVALID");
  });
});
