import type {
  ArtifactStore,
  HumanResumeEffectInspectionContext,
  HumanResumeEffectInspectionResult,
  HumanResumeEffectVerifier,
} from "@automation/core";
import { ClassifiedExecutionError } from "@automation/core";
import type { FailureCode } from "@automation/contracts";
import {
  scopedResourceIdentity,
  stableResourceToken,
} from "./idempotency.js";

interface ObservationLocator {
  first(): ObservationLocator;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
}

/**
 * Deliberately narrower than Playwright Page. Reconciliation code can observe URL,
 * title, text visibility, and DOM visibility, but cannot navigate/click/type.
 */
export interface PlaywrightReconciliationObservationPage {
  url(): string;
  title(): Promise<string>;
  getByText(text: string, options?: { exact?: boolean }): ObservationLocator;
  locator(selector: string): ObservationLocator;
}

function classifiedFailure(
  code: FailureCode,
  message: string,
  nodeId: string,
  retryable: boolean,
  cause?: unknown,
): ClassifiedExecutionError {
  return new ClassifiedExecutionError(
    {
      code,
      message,
      retryable,
      nodeId,
      evidenceRefs: [],
    },
    cause !== undefined ? { cause } : undefined,
  );
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function observationFailure(error: unknown, nodeId: string): ClassifiedExecutionError {
  if (
    errorName(error) === "TimeoutError" ||
    /timeout|timed out|target page|browser has been closed|connection closed|websocket.*closed/i.test(
      errorMessage(error),
    )
  ) {
    return classifiedFailure(
      "TRANSIENT_NETWORK",
      "reconciliation browser observation was unavailable",
      nodeId,
      true,
      error,
    );
  }
  return classifiedFailure(
    "UNKNOWN",
    "reconciliation browser observation failed",
    nodeId,
    false,
    error,
  );
}

function pageOrigin(page: PlaywrightReconciliationObservationPage): string | null {
  try {
    const parsed = new URL(page.url());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function fingerprint(page: PlaywrightReconciliationObservationPage): Promise<string> {
  const url = page.url();
  let title = "";
  try {
    title = await page.title();
  } catch {
    // The inspection result is still fingerprintable by last-known URL.
  }
  return `page:${stableResourceToken(`${url}\u0000${title}`).slice(0, 32)}`;
}

function evidenceKey(
  context: HumanResumeEffectInspectionContext,
  stateFingerprint: string,
): string {
  const runDigest = stableResourceToken(
    scopedResourceIdentity(context.scope, context.runId, "human-resume-reconciliation"),
  ).slice(0, 32);
  const effectDigest = stableResourceToken(context.effectId).slice(0, 24);
  const stateDigest = stableResourceToken(stateFingerprint).slice(0, 16);
  return `runs/${runDigest}/reconciliation/${effectDigest}-${stateDigest}.json`;
}

/**
 * AWS/Playwright observation-only reconciliation adapter.
 *
 * Current VerificationSpec contracts describe a positive expected state only. A
 * positive DOM/TEXT/URL observation proves ALREADY_APPLIED. A negative observation
 * does not prove that the external effect never occurred (the page may have moved,
 * content may have disappeared, etc.), so it remains AMBIGUOUS. This adapter never
 * manufactures DEFINITELY_NOT_APPLIED from ordinary verification failure.
 */
export class AgentCorePlaywrightHumanResumeEffectVerifier
  implements HumanResumeEffectVerifier
{
  constructor(
    private readonly page: PlaywrightReconciliationObservationPage,
    private readonly artifacts: ArtifactStore,
  ) {}

  async inspect(
    context: HumanResumeEffectInspectionContext,
  ): Promise<HumanResumeEffectInspectionResult> {
    const expected = context.verification.expected;
    if (
      (context.verification.mode === "URL" ||
        context.verification.mode === "TEXT" ||
        context.verification.mode === "DOM") &&
      !expected
    ) {
      throw classifiedFailure(
        "NOT_CONFIGURED",
        "reconciliation verification requires a non-empty expected value",
        context.node.id,
        false,
      );
    }

    let applied: boolean;
    try {
      switch (context.verification.mode) {
        case "URL":
          applied = this.page.url().includes(expected ?? "");
          break;
        case "TEXT":
          applied = await this.page
            .getByText(expected ?? "", { exact: false })
            .first()
            .isVisible({ timeout: context.verification.timeoutMs });
          break;
        case "DOM":
          applied = await this.page
            .locator(expected ?? "")
            .first()
            .isVisible({ timeout: context.verification.timeoutMs });
          break;
        case "MODEL":
        case "CUSTOM":
          throw classifiedFailure(
            "NOT_CONFIGURED",
            `${context.verification.mode} reconciliation requires an explicit observation-only verifier adapter`,
            context.node.id,
            false,
          );
      }
    } catch (error) {
      if (error instanceof ClassifiedExecutionError) throw error;
      throw observationFailure(error, context.node.id);
    }

    const decision = applied ? "ALREADY_APPLIED" : "AMBIGUOUS";
    const stateFingerprint = await fingerprint(this.page);

    try {
      const artifact = await this.artifacts.put(
        context.scope,
        evidenceKey(context, stateFingerprint),
        new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: 1,
            kind: "human-resume-effect-reconciliation",
            nodeKind: context.node.kind,
            verificationMode: context.verification.mode,
            decision,
            stateFingerprint,
            origin: pageOrigin(this.page),
          }),
        ),
        "application/json",
      );
      return { decision, evidenceRefs: [artifact.ref] };
    } catch (error) {
      throw classifiedFailure(
        "UNKNOWN",
        "reconciliation evidence persistence failed",
        context.node.id,
        false,
        error,
      );
    }
  }
}
