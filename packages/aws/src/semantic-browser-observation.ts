import type { Page } from "playwright-core";
import {
  ClassifiedExecutionError,
  type SemanticBrowserObservation,
  type SemanticInteractiveObservation,
} from "@automation/core";
import type { WorkflowNode } from "@automation/contracts";

const MAX_INTERACTIVE_OBSERVATIONS = 32;
const MAX_OBSERVATION_TEXT = 160;
const MAX_TEST_ID = 120;
const MAX_ORIGIN = 512;
const MAX_SERIALIZED_BYTES = 16 * 1024;

const SAFE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "spinbutton",
  "slider",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
]);

interface RawInteractiveObservation {
  role?: unknown;
  name?: unknown;
  testId?: unknown;
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function safeOrigin(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin.slice(0, MAX_ORIGIN);
  } catch {
    return undefined;
  }
}

function normalizeInteractive(
  raw: readonly RawInteractiveObservation[],
): readonly SemanticInteractiveObservation[] {
  const normalized: SemanticInteractiveObservation[] = [];
  for (const candidate of raw) {
    if (normalized.length >= MAX_INTERACTIVE_OBSERVATIONS) break;
    const role = boundedText(candidate.role, 32)?.toLowerCase();
    if (!role || !SAFE_ROLES.has(role)) continue;
    const name = boundedText(candidate.name, MAX_OBSERVATION_TEXT);
    const testId = boundedText(candidate.testId, MAX_TEST_ID);
    if (!name && !testId) continue;
    normalized.push({
      role,
      ...(name ? { name } : {}),
      ...(testId ? { testId } : {}),
    });
  }
  return normalized;
}

function observationFailure(nodeId: string, cause?: unknown): ClassifiedExecutionError {
  return new ClassifiedExecutionError(
    {
      code: "TRANSIENT_NETWORK",
      message: "browser observations are temporarily unavailable for semantic recovery",
      retryable: true,
      nodeId,
      evidenceRefs: [],
    },
    cause !== undefined ? { cause } : undefined,
  );
}

/**
 * Capture a small, observation-only description of the currently visible interactive
 * page surface. The browser-side collector intentionally never reads input values,
 * cookies, storage, DOM HTML, hidden text, screenshots, or session/profile identity.
 */
export async function captureSemanticBrowserObservation(
  page: Page,
  node: WorkflowNode,
): Promise<SemanticBrowserObservation> {
  try {
    const [title, raw] = await Promise.all([
      page.title(),
      page.evaluate((limit) => {
        const nativeRole = (element: Element): string | undefined => {
          const explicit = element.getAttribute("role")?.trim().toLowerCase();
          if (explicit) return explicit;
          const tag = element.tagName.toLowerCase();
          if (tag === "button") return "button";
          if (tag === "a" && element.hasAttribute("href")) return "link";
          if (tag === "textarea") return "textbox";
          if (tag === "select") {
            return (element as HTMLSelectElement).multiple ? "listbox" : "combobox";
          }
          if (tag !== "input") return undefined;
          const type = ((element as HTMLInputElement).type || "text").toLowerCase();
          if (["button", "submit", "reset"].includes(type)) return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "search") return "searchbox";
          if (type === "number") return "spinbutton";
          if (type === "range") return "slider";
          if (["text", "email", "tel", "url", "password"].includes(type)) return "textbox";
          return undefined;
        };

        const accessibleName = (element: Element): string | undefined => {
          const ariaLabel = element.getAttribute("aria-label")?.trim();
          if (ariaLabel) return ariaLabel;
          const labelledBy = element.getAttribute("aria-labelledby")?.trim();
          if (labelledBy) {
            const text = labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
              .filter(Boolean)
              .join(" ")
              .trim();
            if (text) return text;
          }
          const id = element.getAttribute("id")?.trim();
          if (id) {
            const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
            const text = document.querySelector(`label[for="${escaped}"]`)?.textContent?.trim();
            if (text) return text;
          }
          const ancestorLabel = element.closest("label")?.textContent?.trim();
          if (ancestorLabel) return ancestorLabel;
          const tag = element.tagName.toLowerCase();
          if (tag === "button" || tag === "a") {
            const text = element.textContent?.trim();
            if (text) return text;
          }
          return undefined;
        };

        const isVisible = (element: Element): boolean => {
          const html = element as HTMLElement;
          const style = globalThis.getComputedStyle(html);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
          const rect = html.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const candidates = Array.from(
          document.querySelector(
            "body",
          )?.querySelectorAll(
            'button,a[href],input:not([type="hidden"]),textarea,select,[role]',
          ) ?? [],
        );
        const result: { role?: string; name?: string; testId?: string }[] = [];
        for (const element of candidates) {
          if (result.length >= limit * 2) break;
          if (!isVisible(element)) continue;
          const role = nativeRole(element);
          if (!role) continue;
          const name = accessibleName(element);
          const testId = element.getAttribute("data-testid")?.trim() || undefined;
          result.push({ role, ...(name ? { name } : {}), ...(testId ? { testId } : {}) });
        }
        return result;
      }, MAX_INTERACTIVE_OBSERVATIONS),
    ]);

    const origin = safeOrigin(page.url());
    const safeTitle = boundedText(title, MAX_OBSERVATION_TEXT);
    const observation: SemanticBrowserObservation = {
      schemaVersion: 1,
      page: {
        ...(origin !== undefined ? { origin } : {}),
        ...(safeTitle !== undefined ? { title: safeTitle } : {}),
      },
      interactive: normalizeInteractive(
        Array.isArray(raw) ? (raw as RawInteractiveObservation[]) : [],
      ),
    };

    const serialized = JSON.stringify(observation);
    if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) {
      throw new Error("bounded semantic observation exceeded serialized byte limit");
    }
    return observation;
  } catch (error) {
    if (error instanceof ClassifiedExecutionError) throw error;
    throw observationFailure(node.id, error);
  }
}
