export function isSameOriginMutation(requestUrl: string, headers: Headers): boolean {
  const target = new URL(requestUrl);
  const origin = headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === target.origin;
    } catch {
      return false;
    }
  }
  const fetchSite = headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

export function safeNotice(value: string): string {
  const allowed = new Set(["created", "compiled", "tested", "published", "not-configured", "request-failed", "invalid-input"]);
  return allowed.has(value) ? value : "request-failed";
}
