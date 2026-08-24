import { cookies } from "next/headers";
import { WebControlPlaneClient, readWebControlPlaneConfig } from "./control-plane-client";
import { loadWebCognitoAuthConfig, refreshAccessToken } from "./cognito-session";

export const ACCESS_COOKIE = "__Host-automation_access";
export const REFRESH_COOKIE = "__Host-automation_refresh";
export const OAUTH_COOKIE = "__Host-automation_oauth";

export type WebAuthStatus =
  | { kind: "NOT_CONFIGURED" }
  | { kind: "SIGNED_OUT" }
  | { kind: "AUTHENTICATED" };

export class WebAuthError extends Error {
  constructor(readonly code: "NOT_CONFIGURED" | "UNAUTHENTICATED" | "REFRESH_FAILED") {
    super(code === "NOT_CONFIGURED" ? "Authentication is not configured" : "Authentication is required");
    this.name = "WebAuthError";
  }
}

export async function getWebAuthStatus(): Promise<WebAuthStatus> {
  const loaded = loadWebCognitoAuthConfig();
  if (!loaded.configured) return { kind: "NOT_CONFIGURED" };
  const cookieStore = await cookies();
  return cookieStore.has(ACCESS_COOKIE) || cookieStore.has(REFRESH_COOKIE)
    ? { kind: "AUTHENTICATED" }
    : { kind: "SIGNED_OUT" };
}

export async function resolveWebAccessToken(): Promise<string> {
  const loaded = loadWebCognitoAuthConfig();
  if (!loaded.configured) throw new WebAuthError("NOT_CONFIGURED");
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (accessToken) return accessToken;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) throw new WebAuthError("UNAUTHENTICATED");
  try {
    return (await refreshAccessToken(loaded.config, refreshToken)).accessToken;
  } catch {
    throw new WebAuthError("REFRESH_FAILED");
  }
}

export async function createAuthenticatedWebControlPlaneClient(): Promise<WebControlPlaneClient> {
  const bearerToken = await resolveWebAccessToken();
  return new WebControlPlaneClient({ ...readWebControlPlaneConfig(), bearerToken });
}
