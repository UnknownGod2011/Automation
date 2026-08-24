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

interface LiveViewHandoffContent {
  title: string;
  heading: string;
  introduction: string;
  openLabel: string;
  returnHref: string;
  returnLabel: string;
  instruction: string;
  openInNewTab: boolean;
}

function createLiveViewHandoff(rawLiveViewUrl: string, content: LiveViewHandoffContent): Response {
  const liveView = validatedLiveViewUrl(rawLiveViewUrl);
  const liveViewHref = escapeHtml(liveView.toString());
  const returnHref = escapeHtml(content.returnHref);
  const target = content.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : ' rel="noreferrer"';

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(content.title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(content.heading)}</h1>
    <p>${escapeHtml(content.introduction)}</p>
    <p><a id="open-live-view" href="${liveViewHref}"${target}>${escapeHtml(content.openLabel)}</a></p>
    <p><a id="return-to-product" href="${returnHref}">${escapeHtml(content.returnLabel)}</a></p>
    <p>${escapeHtml(content.instruction)}</p>
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
  return createLiveViewHandoff(rawLiveViewUrl, {
    title: "Open secure capture browser",
    heading: "Open the secure capture browser in a new tab",
    introduction: "Keep this product tab available. Open Live View in a separate tab, finish signing in to the target site there, then return here and go back to the automation to start recording.",
    openLabel: "Open Live View in a new tab",
    returnHref: `/automations/${encodeURIComponent(automationId)}`,
    returnLabel: "Return to automation",
    instruction: "After you press Start recording workflow in the product, switch back to the Live View tab and demonstrate only the actions you want replayed.",
    openInNewTab: true,
  });
}

/**
 * Human takeover is opened from a form whose target is already a separate tab.
 * This handoff keeps the signed Live View capability out of redirect headers and
 * navigates that handoff tab into Live View only after an explicit user click.
 * The original run-diagnostics tab therefore remains available for Save & Resume.
 */
export function createHumanTakeoverLiveViewHandoff(
  automationId: string,
  runId: string,
  rawLiveViewUrl: string,
): Response {
  if (!automationId.trim()) throw new Error("automationId is required");
  if (!runId.trim()) throw new Error("runId is required");
  return createLiveViewHandoff(rawLiveViewUrl, {
    title: "Open secure repair browser",
    heading: "Open the secure repair browser",
    introduction: "Use Live View only to repair the target-site session. Sign in or complete required MFA yourself; the platform will not solve or bypass CAPTCHA, MFA, or other security controls.",
    openLabel: "Open Live View in this tab",
    returnHref: `/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`,
    returnLabel: "Return to run diagnostics",
    instruction: "When the target site is usable again, return to the original run-diagnostics tab and choose Save repaired session & resume.",
    openInNewTab: false,
  });
}
