const DEMO_AUTH_COOKIE = "automation_demo_auth";
const DEMO_AUTH_VALUE = "authenticated";
const DEFAULT_SESSION_TTL_SECONDS = 900;
const MIN_SESSION_TTL_SECONDS = 60;
const MAX_SESSION_TTL_SECONDS = 3600;
const MAX_NOTE_LENGTH = 4096;

export interface DemoTargetConfig {
  enabled: boolean;
  sessionTtlSeconds: number;
}

export function readDemoTargetConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DemoTargetConfig {
  const enabled = env.AUTOMATION_DEMO_TARGET_ENABLED === "true";
  const rawTtl = env.AUTOMATION_DEMO_TARGET_SESSION_TTL_SECONDS;
  const sessionTtlSeconds = rawTtl === undefined || rawTtl === ""
    ? DEFAULT_SESSION_TTL_SECONDS
    : Number(rawTtl);

  if (
    !Number.isInteger(sessionTtlSeconds)
    || sessionTtlSeconds < MIN_SESSION_TTL_SECONDS
    || sessionTtlSeconds > MAX_SESSION_TTL_SECONDS
  ) {
    throw new Error("demo target configuration is invalid");
  }

  return { enabled, sessionTtlSeconds };
}

function cookiePairs(cookieHeader: string | null): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  if (!cookieHeader) return pairs;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !pairs.has(name)) pairs.set(name, value);
  }
  return pairs;
}

export function hasDemoTargetSession(cookieHeader: string | null): boolean {
  return cookiePairs(cookieHeader).get(DEMO_AUTH_COOKIE) === DEMO_AUTH_VALUE;
}

export function demoTargetSessionCookie(ttlSeconds: number): string {
  if (
    !Number.isInteger(ttlSeconds)
    || ttlSeconds < MIN_SESSION_TTL_SECONDS
    || ttlSeconds > MAX_SESSION_TTL_SECONDS
  ) {
    throw new Error("demo target session TTL is invalid");
  }
  return `${DEMO_AUTH_COOKIE}=${DEMO_AUTH_VALUE}; Path=/demo-target; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function demoTargetHeaders(): Readonly<Record<string, string>> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function document(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

export function demoTargetLoginHtml(): string {
  return document(
    "Automation demo sign-in",
    '<h1>Demo target sign-in</h1><p>This is a controlled test target. Its session expires automatically so target-auth repair can be demonstrated safely.</p><form method="post" action="/demo-target/login"><button type="submit" data-testid="demo-login">Sign in to demo target</button></form>',
  );
}

export function demoTargetWorkflowHtml(): string {
  return document(
    "Automation demo task",
    '<h1>Demo workflow target</h1><p>Enter a non-secret demo note and submit it.</p><form method="post" action="/demo-target/action" data-testid="demo-form"><label for="demo-note">Demo note</label><textarea id="demo-note" name="note" data-testid="demo-note" maxlength="4096" required></textarea><button type="submit" data-testid="demo-submit">Complete demo task</button></form>',
  );
}

export function demoTargetCompletedHtml(): string {
  return document(
    "Automation demo completed",
    '<h1>Demo workflow target</h1><div role="status" data-testid="demo-complete">Demo task completed.</div><a href="/demo-target" data-testid="demo-reset">Start another demo task</a>',
  );
}

export function demoTargetBadRequestHtml(): string {
  return document(
    "Invalid demo request",
    "<h1>Invalid demo request</h1><p>The demo note must be a string no longer than 4,096 characters.</p>",
  );
}

export function isValidDemoNote(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && value.length <= MAX_NOTE_LENGTH;
}
