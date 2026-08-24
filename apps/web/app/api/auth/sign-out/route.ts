import { NextResponse } from "next/server";
import { buildLogoutUrl, loadWebCognitoAuthConfig } from "../../../../lib/cognito-session";
import { isSameOriginMutation } from "../../../../lib/mutation-security";
import { ACCESS_COOKIE, OAUTH_COOKIE, REFRESH_COOKIE } from "../../../../lib/server-auth";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginMutation(request.url, request.headers)) return new NextResponse("Forbidden", { status: 403 });
  const loaded = loadWebCognitoAuthConfig();
  const response = loaded.configured
    ? NextResponse.redirect(buildLogoutUrl(loaded.config), 303)
    : NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
