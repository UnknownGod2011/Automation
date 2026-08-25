import {
  demoTargetSessionCookie,
  readDemoTargetConfig,
} from "../../../lib/demo-target";

function unavailable(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let config;
  try {
    config = readDemoTargetConfig();
  } catch {
    return unavailable(503, "Demo target is not configured");
  }
  if (!config.enabled) return unavailable(404, "Not found");

  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL("/demo-target", request.url).toString(),
      "Set-Cookie": demoTargetSessionCookie(config.sessionTtlSeconds),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
