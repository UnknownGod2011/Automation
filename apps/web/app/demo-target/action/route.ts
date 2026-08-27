import {
  demoTargetBadRequestHtml,
  demoTargetCompletedHtml,
  demoTargetHeaders,
  demoTargetLoginHtml,
  hasDemoTargetSession,
  isValidDemoConfirmation,
  isValidDemoNote,
  isValidDemoPriority,
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
  const priority = form.get("priority");
  const note = form.get("note");
  const confirmation = form.get("confirm");
  if (
    !isValidDemoPriority(priority)
    || !isValidDemoNote(note)
    || !isValidDemoConfirmation(confirmation)
  ) {
    return new Response(demoTargetBadRequestHtml(), {
      status: 400,
      headers: demoTargetHeaders(),
    });
  }

  // Submitted values are intentionally never reflected into the response. Capture represents
  // priority and note through runtime inputs while the checkbox becomes immutable CHECK intent.
  // The controlled target stores no durable application state.
  return new Response(demoTargetCompletedHtml(), {
    status: 200,
    headers: demoTargetHeaders(),
  });
}
