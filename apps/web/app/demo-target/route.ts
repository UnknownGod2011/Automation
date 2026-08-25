import {
  demoTargetHeaders,
  demoTargetLoginHtml,
  demoTargetWorkflowHtml,
  hasDemoTargetSession,
  readDemoTargetConfig,
} from "../../lib/demo-target";

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

export async function GET(request: Request): Promise<Response> {
  let config;
  try {
    config = readDemoTargetConfig();
  } catch {
    return unavailable(503, "Demo target is not configured");
  }
  if (!config.enabled) return unavailable(404, "Not found");

  const authenticated = hasDemoTargetSession(request.headers.get("cookie"));
  return new Response(
    authenticated ? demoTargetWorkflowHtml() : demoTargetLoginHtml(),
    {
      status: authenticated ? 200 : 401,
      headers: demoTargetHeaders(),
    },
  );
}
