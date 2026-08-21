import type { Page } from "playwright-core";
import { stableResourceToken } from "./idempotency.js";

const MAX_STRUCTURAL_MARKERS = 256;

interface CaptureStructuralMarker {
  tag: string;
  role?: string;
  testId?: string;
  id?: string;
  type?: string;
  ariaExpanded?: string;
  ariaPressed?: string;
  ariaChecked?: string;
  ariaSelected?: string;
  ariaDisabled?: string;
}

function safeLocation(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "non-http";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function normalizeMarker(value: unknown): CaptureStructuralMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tag = typeof record.tag === "string" ? record.tag.slice(0, 32) : "";
  if (!tag) return null;
  const optional = (name: string, max = 128): string | undefined => {
    const candidate = record[name];
    if (typeof candidate !== "string") return undefined;
    const trimmed = candidate.trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
  };
  const role = optional("role");
  const testId = optional("testId");
  const id = optional("id");
  const type = optional("type", 32);
  const ariaExpanded = optional("ariaExpanded", 16);
  const ariaPressed = optional("ariaPressed", 16);
  const ariaChecked = optional("ariaChecked", 16);
  const ariaSelected = optional("ariaSelected", 16);
  const ariaDisabled = optional("ariaDisabled", 16);
  return {
    tag,
    ...(role ? { role } : {}),
    ...(testId ? { testId } : {}),
    ...(id ? { id } : {}),
    ...(type ? { type } : {}),
    ...(ariaExpanded ? { ariaExpanded } : {}),
    ...(ariaPressed ? { ariaPressed } : {}),
    ...(ariaChecked ? { ariaChecked } : {}),
    ...(ariaSelected ? { ariaSelected } : {}),
    ...(ariaDisabled ? { ariaDisabled } : {}),
  };
}

/**
 * Produces a stable digest of page structure for capture-time effect verification.
 * The persisted value contains no text content, form values, query strings, hashes,
 * cookies, storage, or raw DOM. Structural identifiers exist only transiently while
 * computing the digest inside the worker.
 */
export async function captureSafePageStateFingerprint(page: Page): Promise<string> {
  const rawMarkers = await page.evaluate((limit) => {
    const selector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "form",
      "[role]",
      "[data-testid]",
      "[data-test-id]",
      "[aria-expanded]",
      "[aria-pressed]",
      "[aria-checked]",
      "[aria-selected]",
      "[aria-disabled]",
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .slice(0, limit)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") ?? undefined,
        testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test-id") ?? undefined,
        id: element.id || undefined,
        type: element.getAttribute("type") ?? undefined,
        ariaExpanded: element.getAttribute("aria-expanded") ?? undefined,
        ariaPressed: element.getAttribute("aria-pressed") ?? undefined,
        ariaChecked: element.getAttribute("aria-checked") ?? undefined,
        ariaSelected: element.getAttribute("aria-selected") ?? undefined,
        ariaDisabled: element.getAttribute("aria-disabled") ?? undefined,
      }));
  }, MAX_STRUCTURAL_MARKERS);

  const markers = Array.isArray(rawMarkers)
    ? rawMarkers
        .map(normalizeMarker)
        .filter((marker): marker is CaptureStructuralMarker => marker !== null)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];
  const payload = JSON.stringify({
    location: safeLocation(page.url()),
    markers,
  });
  return `capture:state:${stableResourceToken(payload)}`;
}
