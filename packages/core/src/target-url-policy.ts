type Ipv4Address = readonly [number, number, number, number];

const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".home.arpa"] as const;
const LOCAL_HOST_NAMES = new Set(["localhost", "home.arpa", "metadata.google.internal"]);

function normalizedHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (lower.startsWith("[") && lower.endsWith("]")) return lower.slice(1, -1);
  return lower;
}

function parseIpv4(hostname: string): Ipv4Address | null {
  const pieces = hostname.split(".");
  if (pieces.length !== 4) return null;
  const a = Number(pieces[0]);
  const b = Number(pieces[1]);
  const c = Number(pieces[2]);
  const d = Number(pieces[3]);
  if (![a, b, c, d].every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return null;
  return [a, b, c, d];
}

function isNonPublicIpv4([a, b, c]: Ipv4Address): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
}

function firstIpv6Hextet(hostname: string): number | null {
  const first = hostname.split(":", 1)[0];
  if (!first) return null;
  const parsed = Number.parseInt(first, 16);
  return Number.isInteger(parsed) ? parsed : null;
}

function isNonPublicIpv6(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") return true;
  if (hostname.startsWith("::ffff:")) return true;
  if (hostname.startsWith("2001:db8:")) return true;
  const first = firstIpv6Hextet(hostname);
  if (first === null) return false;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isLocalHostname(hostname: string): boolean {
  if (LOCAL_HOST_NAMES.has(hostname)) return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  return !hostname.includes(".");
}

/**
 * Normalize and validate a user-selected website before it becomes cloud-browser
 * navigation authority. This is an application-layer SSRF guard: it blocks
 * explicit local/private targets and embedded credentials, but callers must
 * still enforce runtime DNS/redirect/egress policy because a public hostname can
 * later resolve or redirect to a private address.
 */
export function normalizeAutomationTargetUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("websiteUrl must be a valid HTTP(S) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("websiteUrl must be a valid HTTP(S) URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("websiteUrl must not contain embedded credentials");
  }

  const hostname = normalizedHostname(parsed.hostname);
  if (!hostname) throw new Error("websiteUrl must contain a public network host");

  const ipv4 = parseIpv4(hostname);
  const blocked = ipv4
    ? isNonPublicIpv4(ipv4)
    : hostname.includes(":")
      ? isNonPublicIpv6(hostname)
      : isLocalHostname(hostname);
  if (blocked) throw new Error("websiteUrl must target a public network host");

  return parsed.toString();
}
