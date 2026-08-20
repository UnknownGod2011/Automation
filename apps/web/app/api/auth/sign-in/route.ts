import { NextResponse } from "next/server";
import { buildAuthorizeUrl, createOAuthTransaction, encodeOAuthTransaction, loadWebCognitoAuthConfig, sanitizeReturnTo } from "../../../../lib/cognito-session";
import { OAUTH_COOKIE } from "../../../../lib/server-auth";

export async function GET(request: Request): Promise<NextResponse> {
  const loaded = loadWebCognitoAuthConfig();
  if (!loaded.configured) return NextResponse.redirect(new URL("/?notice=auth-not-configured", request.url), 303);
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const { transaction, challenge } = createOAuthTransaction(returnTo);
  const response = NextResponse.redirect(buildAuthorizeUrl(loaded.config, transaction, challenge), 303);
  response.cookies.set(OAUTH_COOKIE, encodeOAuthTransaction(transaction), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
