import {
  demoTargetBadRequestHtml,
  demoTargetCompletedHtml,
  demoTargetHeaders,
  demoTargetLoginHtml,
  hasDemoTargetSession,
  isValidDemoNote,
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

  if (!hasDemoTargetSession(request.headers.get("cookie"))) {
    return new Response(demoTargetLoginHtml(), {
      status: 401,
      headers: demoTargetHeaders(),
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(demoTargetBadRequestHtml(), {
      status: 400,
      headers: demoTargetHeaders(),
    });
  }
  const note = form.get("note");
  if (!isValidDemoNote(note)) {
    return new Response(demoTargetBadRequestHtml(), {
      status: 400,
      headers: demoTargetHeaders(),
    });
  }

  // The note is intentionally never reflected into the response. During capture it
  // becomes a runtime variable, and INPUT screenshots remain suppressed.
  return new Response(demoTargetCompletedHtml(), {
    status: 200,
    headers: demoTargetHeaders(),
  });
}
