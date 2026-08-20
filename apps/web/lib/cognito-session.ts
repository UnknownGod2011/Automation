import { createHash, randomBytes } from "node:crypto";

export interface WebCognitoAuthConfig {
  domain: URL;
  clientId: string;
  origin: URL;
}

export type WebCognitoAuthConfigResult =
  | { configured: true; config: WebCognitoAuthConfig }
  | { configured: false; missing: readonly string[]; reason: "MISSING_CONFIG" | "INVALID_CONFIG" };

export interface OAuthTransaction {
  state: string;
  verifier: string;
  returnTo: string;
  issuedAt: number;
}

export interface CognitoTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function safeHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function loadWebCognitoAuthConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebCognitoAuthConfigResult {
  const rawDomain = envValue(env, "AUTOMATION_COGNITO_DOMAIN");
  const clientId = envValue(env, "AWS_COGNITO_APP_CLIENT_ID");
  const rawOrigin = envValue(env, "AUTOMATION_WEB_ORIGIN");
  const missing: string[] = [];
  if (!rawDomain) missing.push("AUTOMATION_COGNITO_DOMAIN");
  if (!clientId) missing.push("AWS_COGNITO_APP_CLIENT_ID");
  if (!rawOrigin) missing.push("AUTOMATION_WEB_ORIGIN");
  if (!rawDomain || !clientId || !rawOrigin) return { configured: false, missing, reason: "MISSING_CONFIG" };

  const domain = safeHttpsUrl(rawDomain);
  const origin = safeHttpsUrl(rawOrigin);
  if (!domain || !origin || domain.pathname !== "/" || origin.pathname !== "/") {
    return { configured: false, missing: [], reason: "INVALID_CONFIG" };
  }
  return { configured: true, config: { domain, clientId, origin } };
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function createOAuthTransaction(returnTo = "/", now = Date.now()): { transaction: OAuthTransaction; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return {
    transaction: { state, verifier, returnTo: sanitizeReturnTo(returnTo), issuedAt: now },
    challenge,
  };
}

export function encodeOAuthTransaction(transaction: OAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction), "utf8").toString("base64url");
}

export function decodeOAuthTransaction(value: string | undefined, now = Date.now()): OAuthTransaction | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthTransaction>;
    if (
      typeof parsed.state !== "string" || !parsed.state ||
      typeof parsed.verifier !== "string" || parsed.verifier.length < 43 ||
      typeof parsed.returnTo !== "string" || sanitizeReturnTo(parsed.returnTo) !== parsed.returnTo ||
      typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt) ||
      parsed.issuedAt > now || now - parsed.issuedAt > 10 * 60 * 1000
    ) return undefined;
    return parsed as OAuthTransaction;
  } catch {
    return undefined;
  }
}

export function buildAuthorizeUrl(config: WebCognitoAuthConfig, transaction: OAuthTransaction, challenge: string): URL {
  const url = new URL("/oauth2/authorize", config.domain);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", new URL("/api/auth/callback", config.origin).toString());
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  return url;
}

export function buildLogoutUrl(config: WebCognitoAuthConfig): URL {
  const url = new URL("/logout", config.domain);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("logout_uri", config.origin.toString());
  return url;
}

async function parseTokenResponse(response: Response, requireRefreshToken: boolean): Promise<CognitoTokens> {
  if (!response.ok) throw new Error("COGNITO_TOKEN_EXCHANGE_FAILED");
  const payload = await response.json() as Record<string, unknown>;
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;
  const expiresIn = payload.expires_in;
  const tokenType = payload.token_type;
  if (
    typeof accessToken !== "string" || !accessToken ||
    (requireRefreshToken && (typeof refreshToken !== "string" || !refreshToken)) ||
    typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0 ||
    typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"
  ) throw new Error("COGNITO_TOKEN_RESPONSE_INVALID");
  return {
    accessToken,
    expiresIn,
    ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}),
  };
}

export async function exchangeAuthorizationCode(
  config: WebCognitoAuthConfig,
  code: string,
  verifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<CognitoTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: new URL("/api/auth/callback", config.origin).toString(),
    code_verifier: verifier,
  });
  const response = await fetchImpl(new URL("/oauth2/token", config.domain), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  return parseTokenResponse(response, true);
}

export async function refreshAccessToken(
  config: WebCognitoAuthConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<CognitoTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(new URL("/oauth2/token", config.domain), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  return parseTokenResponse(response, false);
}
