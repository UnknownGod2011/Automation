const MAX_LIVE_VIEW_URL_LENGTH = 8_192;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validatedLiveViewUrl(rawLiveViewUrl: string): URL {
  const trimmed = rawLiveViewUrl.trim();
  if (!trimmed || trimmed.length > MAX_LIVE_VIEW_URL_LENGTH) {
    throw new Error("Live View URL is missing or exceeds the supported length");
  }

  const liveView = new URL(trimmed);
  if (liveView.protocol !== "https:" || liveView.username || liveView.password) {
    throw new Error("Live View URL must be HTTPS without embedded credentials");
  }
  return liveView;
}

/**
 * Returns an ephemeral, non-cacheable handoff document instead of navigating the
 * product tab directly into Live View. The user opens Live View in a separate
 * tab, keeping the authenticated control-plane tab available for Start/Finish.
 *
 * The Live View capability is present only in this response body. It is never
 * placed in the product URL, a cookie, local storage, or a redirect Location.
 */
export function createCaptureLiveViewHandoff(automationId: string, rawLiveViewUrl: string): Response {
  if (!automationId.trim()) throw new Error("automationId is required");
  const liveView = validatedLiveViewUrl(rawLiveViewUrl);
  const liveViewHref = escapeHtml(liveView.toString());
  const automationHref = escapeHtml(`/automations/${encodeURIComponent(automationId)}`);

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Open secure capture browser</title>
</head>
<body>
  <main>
    <h1>Open the secure capture browser in a new tab</h1>
    <p>Keep this product tab available. Open Live View in a separate tab, finish signing in to the target site there, then return here and go back to the automation to start recording.</p>
    <p><a id="open-live-view" href="${liveViewHref}" target="_blank" rel="noopener noreferrer">Open Live View in a new tab</a></p>
    <p><a id="return-to-automation" href="${automationHref}">Return to automation</a></p>
    <p>After you press <strong>Start recording workflow</strong> in the product, switch back to the Live View tab and demonstrate only the actions you want replayed.</p>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "cross-origin-opener-policy": "same-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
