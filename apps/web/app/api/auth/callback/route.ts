import { NextResponse } from "next/server";
import { decodeOAuthTransaction, exchangeAuthorizationCode, loadWebCognitoAuthConfig } from "../../../../lib/cognito-session";
import { ACCESS_COOKIE, OAUTH_COOKIE, REFRESH_COOKIE } from "../../../../lib/server-auth";

export async function GET(request: Request): Promise<NextResponse> {
  const loaded = loadWebCognitoAuthConfig();
  if (!loaded.configured) return NextResponse.redirect(new URL("/?notice=auth-not-configured", request.url), 303);

  const requestUrl = new URL(request.url);
  const transaction = decodeOAuthTransaction(request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${OAUTH_COOKIE}=([^;]+)`))?.[1]);
  const code = requestUrl.searchParams.get("code")?.trim();
  const state = requestUrl.searchParams.get("state")?.trim();
  if (!transaction || !code || !state || state !== transaction.state || requestUrl.searchParams.has("error")) {
    const failed = NextResponse.redirect(new URL("/?notice=auth-failed", request.url), 303);
    failed.cookies.delete(OAUTH_COOKIE);
    return failed;
  }

  try {
    const tokens = await exchangeAuthorizationCode(loaded.config, code, transaction.verifier);
    if (!tokens.refreshToken) throw new Error("refresh token missing");
    const response = NextResponse.redirect(new URL(transaction.returnTo, loaded.config.origin), 303);
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: tokens.expiresIn,
    });
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch {
    const failed = NextResponse.redirect(new URL("/?notice=auth-failed", request.url), 303);
    failed.cookies.delete(OAUTH_COOKIE);
    return failed;
  }
}
