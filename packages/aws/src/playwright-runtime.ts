import type {
  Locator,
  Page,
} from "playwright-core";
import { chromium } from "playwright-core";
import type {
  ArtifactStore,
  BrowserActionResult,
  BrowserExecutionRuntime,
  BrowserExecutionRuntimeFactory,
  BrowserExecutor,
  BrowserSessionHandle,
  OwnershipScope,
  ReasoningDecision,
  VerificationContext,
  VerificationEngine,
  VerificationResult,
} from "@automation/core";
import { ClassifiedExecutionError } from "@automation/core";
import type {
  FailureCode,
  RunRecord,
  WorkflowNode,
} from "@automation/contracts";
import { captureSafePageStateFingerprint } from "./capture-verification-state.js";
import { captureSemanticBrowserObservation } from "./semantic-browser-observation.js";
import {
  scopedResourceIdentity,
  stableResourceToken,
} from "./idempotency.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const LOCATOR_PROBE_MAX_MS = 1_000;
const MAX_SEMANTIC_WAIT_MS = 60_000;

function sanitizedFailure(
  code: FailureCode,
  message: string,
  nodeId: string,
  retryable: boolean,
  evidenceRefs: readonly string[] = [],
): BrowserActionResult {
  return {
    effectObserved: false,
    evidenceRefs,
    outputs: {},
    failure: {
      code,
      message,
      retryable,
      nodeId,
      evidenceRefs,
    },
  };
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
  if (error instanceof Error) return error.message;
  return "";
}

function isTimeout(error: unknown): boolean {
  return (
    errorName(error) === "TimeoutError" ||
    /timeout|timed out/i.test(errorMessage(error))
  );
}

function isClosed(error: unknown): boolean {
  return /target page, context or browser has been closed|browser has been closed|connection closed|websocket.*closed/i.test(
    errorMessage(error),
  );
}

function connectionFailure(error: unknown): ClassifiedExecutionError {
  const message = errorMessage(error);
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(message)) {
    return classifiedFailure(
      "PROVIDER_AUTH_INVALID",
      "AgentCore Browser connection authorization failed",
      "browser-session",
      false,
      error,
    );
  }
  if (isTimeout(error) || isClosed(error)) {
    return classifiedFailure(
      "TRANSIENT_NETWORK",
      "AgentCore Browser connection is temporarily unavailable",
      "browser-session",
      true,
      error,
    );
  }
  return classifiedFailure(
    "UNKNOWN",
    "AgentCore Browser Playwright connection failed",
    "browser-session",
    false,
    error,
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function remainingMs(deadlineMs: number): number {
  return Math.max(1, deadlineMs - Date.now());
}

function primitiveString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return null;
}

function primitiveBoolean(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function primitiveNumber(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

async function pageStateFingerprint(page: Page): Promise<string> {
  const url = page.url();
  let title = "";
  try {
    title = await page.title();
  } catch {
    // A closed page is still fingerprintable by its last-known URL.
  }
  return `page:${stableResourceToken(`${url}\u0000${title}`).slice(0, 32)}`;
}

function pageOrigin(page: Page): string | null {
  try {
    const parsed = new URL(page.url());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

class PlaywrightEvidenceRecorder {
  private sequence = 0;
  private readonly runDigest: string;

  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly scope: OwnershipScope,
    runId: string,
  ) {
    this.runDigest = stableResourceToken(
      scopedResourceIdentity(scope, runId, "browser-evidence"),
    ).slice(0, 32);
  }

  async record(
    page: Page,
    node: WorkflowNode,
    kind: string,
    includeScreenshot: boolean,
  ): Promise<{ evidenceRefs: readonly string[]; stateFingerprint: string }> {
    this.sequence += 1;
    const sequence = this.sequence.toString().padStart(6, "0");
    const nodeDigest = stableResourceToken(node.id).slice(0, 16);

    try {
      const stateFingerprint = await pageStateFingerprint(page);
      const metadata = new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          kind,
          nodeKind: node.kind,
          sequence: this.sequence,
          stateFingerprint,
          origin: pageOrigin(page),
        }),
      );
      const metadataRef = await this.artifacts.put(
        this.scope,
        `runs/${this.runDigest}/browser/${sequence}-${nodeDigest}-${kind}.json`,
        metadata,
        "application/json",
      );
      const evidenceRefs: string[] = [metadataRef.ref];

      if (includeScreenshot) {
        const screenshot = await page.screenshot({
          type: "png",
          fullPage: false,
        });
        const screenshotRef = await this.artifacts.put(
          this.scope,
          `runs/${this.runDigest}/browser/${sequence}-${nodeDigest}-${kind}.png`,
          screenshot,
          "image/png",
        );
        evidenceRefs.push(screenshotRef.ref);
      }

      return { evidenceRefs, stateFingerprint };
    } catch (error) {
      throw classifiedFailure(
        "UNKNOWN",
        "browser evidence persistence failed",
        node.id,
        false,
        error,
      );
    }
  }
}

function roleLocator(page: Page, value: string): Locator | null {
  const separator = value.indexOf(":");
  const roleValue = (separator >= 0 ? value.slice(0, separator) : value).trim();
  const name = separator >= 0 ? value.slice(separator + 1).trim() : "";
  if (!/^[a-z][a-z0-9_-]*$/i.test(roleValue)) return null;
  const role = roleValue as Parameters<Page["getByRole"]>[0];
  return name
    ? page.getByRole(role, { name, exact: true })
    : page.getByRole(role);
}

function locatorForStrategy(
  page: Page,
  strategy: WorkflowNode["deterministicStrategies"][number],
): Locator | null {
  switch (strategy.kind) {
    case "ROLE":
      return roleLocator(page, strategy.value);
    case "TEXT":
      return page.getByText(strategy.value, { exact: true });
    case "TEST_ID":
      return page.getByTestId(strategy.value);
    case "CSS":
      return page.locator(strategy.value);
    case "XPATH":
      return page.locator(
        strategy.value.startsWith("xpath=")
          ? strategy.value
          : `xpath=${strategy.value}`,
      );
    default:
      return null;
  }
}

async function resolveNodeLocator(
  page: Page,
  node: WorkflowNode,
  deadlineMs: number,
): Promise<Locator | null> {
  for (const strategy of node.deterministicStrategies) {
    if (Date.now() >= deadlineMs) break;
    const locator = locatorForStrategy(page, strategy);
    if (!locator) continue;
    const first = locator.first();
    try {
      if (
        await first.isVisible({
          timeout: Math.min(
            LOCATOR_PROBE_MAX_MS,
            remainingMs(deadlineMs),
          ),
        })
      ) {
        return first;
      }
    } catch (error) {
      if (isClosed(error)) throw error;
      // Resolution failures are safe to fall through because no side effect occurred.
    }
  }
  return null;
}

function semanticLocator(
  page: Page,
  arguments_: Readonly<Record<string, unknown>>,
): Locator | null {
  const selector = primitiveString(arguments_, ["selector"]);
  if (selector) return page.locator(selector).first();

  const testId = primitiveString(arguments_, ["testId", "test_id"]);
  if (testId) return page.getByTestId(testId).first();

  const role = primitiveString(arguments_, ["role"]);
  if (role) {
    const name = primitiveString(arguments_, ["name", "accessibleName"]);
    return roleLocator(page, name ? `${role}:${name}` : role)?.first() ?? null;
  }

  const text = primitiveString(arguments_, ["text", "label"]);
  if (text) return page.getByText(text, { exact: true }).first();

  const xpath = primitiveString(arguments_, ["xpath"]);
  if (xpath) return page.locator(`xpath=${xpath}`).first();

  return null;
}

async function locatorVisible(
  locator: Locator,
  timeoutMs: number,
): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout: timeoutMs });
  } catch (error) {
    if (isClosed(error)) throw error;
    return false;
  }
}

async function verifyCaptureCustomState(
  page: Page,
  node: WorkflowNode,
  expected: string | undefined,
  timeoutMs: number,
  outputs: Readonly<Record<string, unknown>>,
): Promise<{ verified: boolean; detail: string }> {
  if (expected === "capture:input-filled") {
    const typedValue = primitiveString(outputs, ["typedValue"]);
    if (node.kind === "TYPE" && typedValue === null) {
      return {
        verified: false,
        detail: "captured input verification has no transient bound value",
      };
    }
    const deadlineMs = Date.now() + timeoutMs;
    const locator = await resolveNodeLocator(page, node, deadlineMs);
    if (!locator) {
      return { verified: false, detail: "captured input verification target was not found" };
    }
    const value = await locator.inputValue({ timeout: remainingMs(deadlineMs) });
    if (typedValue !== null) {
      return value === typedValue
        ? { verified: true, detail: "captured input bound-value verification passed" }
        : { verified: false, detail: "captured input bound-value verification failed" };
    }
    // Preserve compatibility for legacy non-TYPE nodes that used the older
    // capture:input-filled contract before dedicated control verifiers existed.
    return value.length > 0
      ? { verified: true, detail: "captured input verification passed" }
      : { verified: false, detail: "captured input verification failed" };
  }

  if (expected === "capture:select-bound-value") {
    const selectedValue = primitiveString(outputs, ["selectedValue"]);
    if (selectedValue === null) {
      return { verified: false, detail: "captured select verification has no selected value" };
    }
    const deadlineMs = Date.now() + timeoutMs;
    const locator = await resolveNodeLocator(page, node, deadlineMs);
    if (!locator) {
      return { verified: false, detail: "captured select verification target was not found" };
    }
    const actualValue = await locator.inputValue({ timeout: remainingMs(deadlineMs) });
    return actualValue === selectedValue
      ? { verified: true, detail: "captured select verification passed" }
      : { verified: false, detail: "captured select verification failed" };
  }

  if (expected === "capture:check-bound-state") {
    const checked = primitiveBoolean(outputs, ["checked"]);
    if (checked === null) {
      return { verified: false, detail: "captured checkbox verification has no checked state" };
    }
    const deadlineMs = Date.now() + timeoutMs;
    const locator = await resolveNodeLocator(page, node, deadlineMs);
    if (!locator) {
      return { verified: false, detail: "captured checkbox verification target was not found" };
    }
    const actualChecked = await locator.isChecked({ timeout: remainingMs(deadlineMs) });
    return actualChecked === checked
      ? { verified: true, detail: "captured checkbox verification passed" }
      : { verified: false, detail: "captured checkbox verification failed" };
  }

  if (expected?.startsWith("capture:state:")) {
    const deadlineMs = Date.now() + timeoutMs;
    while (true) {
      if ((await captureSafePageStateFingerprint(page)) === expected) {
        return { verified: true, detail: "captured structural-state verification passed" };
      }
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        return { verified: false, detail: "captured structural-state verification failed" };
      }
      await page.waitForTimeout(Math.min(100, remaining));
    }
  }

  throw classifiedFailure(
    "NOT_CONFIGURED",
    "CUSTOM verification requires a supported explicit verifier contract",
    node.id,
    false,
  );
}

export class AgentCorePlaywrightBrowserExecutor implements BrowserExecutor {
  constructor(
    private readonly page: Page,
    private readonly evidence: PlaywrightEvidenceRecorder,
  ) {}

  async executeDeterministic(
    _scope: OwnershipScope,
    _runId: string,
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult> {
    const deadlineMs = Date.now() + node.timeoutMs;

    try {
      switch (node.kind) {
        case "NAVIGATE":
          return await this.navigate(node, inputs, deadlineMs);
        case "CLICK":
          return await this.click(node, deadlineMs);
        case "TYPE":
          return await this.type(node, inputs, deadlineMs);
        case "SELECT":
          return await this.select(node, inputs, deadlineMs);
        case "CHECK":
          return await this.check(node, inputs, deadlineMs);
        case "EXTRACT":
          return await this.extract(node, deadlineMs);
        case "WAIT":
          return await this.wait(node, inputs, deadlineMs);
        case "VERIFY":
          return await this.noopForVerification(node);
        case "DOWNLOAD":
        case "UPLOAD":
        case "CONDITION":
        case "LOOP":
        case "SUBFLOW":
          return sanitizedFailure(
            "NOT_CONFIGURED",
            `workflow node kind '${node.kind}' is not implemented by the Playwright runtime`,
            node.id,
            false,
          );
        case "REASON":
        case "HUMAN":
        case "END":
          return sanitizedFailure(
            "POLICY_BLOCKED",
            `workflow node kind '${node.kind}' must be handled by the workflow engine`,
            node.id,
            false,
          );
      }
    } catch (error) {
      if (error instanceof ClassifiedExecutionError) throw error;
      if (isClosed(error)) {
        throw classifiedFailure(
          "TRANSIENT_NETWORK",
          "browser session closed during deterministic execution",
          node.id,
          true,
          error,
        );
      }
      if (isTimeout(error)) {
        return sanitizedFailure(
          node.kind === "NAVIGATE" ? "TRANSIENT_NETWORK" : "ELEMENT_NOT_FOUND",
          node.kind === "NAVIGATE"
            ? "browser navigation timed out"
            : "browser target was not actionable before timeout",
          node.id,
          true,
        );
      }
      throw classifiedFailure(
        "UNKNOWN",
        "deterministic browser execution failed",
        node.id,
        false,
        error,
      );
    }
  }

  async executeSemantic(
    _scope: OwnershipScope,
    _runId: string,
    node: WorkflowNode,
    decision: ReasoningDecision,
    _inputs: Readonly<Record<string, unknown>>,
  ): Promise<BrowserActionResult> {
    const deadlineMs = Date.now() + node.timeoutMs;

    try {
      if (
        node.kind !== "REASON" &&
        node.allowedSideEffects.length > 0 &&
        !node.allowedSideEffects.includes(decision.action)
      ) {
        return sanitizedFailure(
          "POLICY_BLOCKED",
          "semantic action is outside the immutable node side-effect constraints",
          node.id,
          false,
        );
      }

      switch (decision.action) {
        case "NAVIGATE": {
          const url = primitiveString(decision.arguments, ["url"]);
          if (!url) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic navigation did not provide a URL",
              node.id,
              false,
            );
          }
          return await this.navigateToUrl(node, url, deadlineMs, "semantic-navigate");
        }
        case "CLICK": {
          const locator = semanticLocator(this.page, decision.arguments);
          if (!locator) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic click did not provide a constrained target",
              node.id,
              false,
            );
          }
          if (!(await locatorVisible(locator, remainingMs(deadlineMs)))) {
            return await this.missingTarget(node, "semantic-click-missing");
          }
          await locator.click({ timeout: remainingMs(deadlineMs) });
          return await this.success(node, {}, "semantic-click", true);
        }
        case "SUBMIT": {
          if (
            node.allowedSideEffects.length !== 1 ||
            node.allowedSideEffects[0] !== "SUBMIT"
          ) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic submit requires immutable submit-only side-effect authority",
              node.id,
              false,
            );
          }
          const locator = semanticLocator(this.page, decision.arguments);
          if (!locator) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic submit did not provide a constrained target",
              node.id,
              false,
            );
          }
          if (!(await locatorVisible(locator, remainingMs(deadlineMs)))) {
            return await this.missingTarget(node, "semantic-submit-missing");
          }
          // Resolve one constrained target and activate it exactly once. Verification
          // remains a separate mandatory engine step before the workflow can advance.
          await locator.click({ timeout: remainingMs(deadlineMs) });
          return await this.success(node, {}, "semantic-submit", true);
        }
        case "TYPE": {
          const locator = semanticLocator(this.page, decision.arguments);
          const value = primitiveString(decision.arguments, ["value", "input", "content"]);
          if (!locator || value === null) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic typing requires a constrained target and value",
              node.id,
              false,
            );
          }
          if (!(await locatorVisible(locator, remainingMs(deadlineMs)))) {
            return await this.missingTarget(node, "semantic-type-missing");
          }
          await locator.fill(value, { timeout: remainingMs(deadlineMs) });
          return await this.success(node, { typedValue: value }, "semantic-type", false);
        }
        case "EXTRACT": {
          const locator = semanticLocator(this.page, decision.arguments);
          if (!locator) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              "semantic extraction did not provide a constrained target",
              node.id,
              false,
            );
          }
          if (!(await locatorVisible(locator, remainingMs(deadlineMs)))) {
            return await this.missingTarget(node, "semantic-extract-missing");
          }
          const value = (await locator.textContent({
            timeout: remainingMs(deadlineMs),
          })) ?? "";
          return await this.success(node, { value }, "semantic-extract", true);
        }
        case "WAIT": {
          const requested = primitiveNumber(decision.arguments, ["milliseconds", "durationMs"]);
          if (requested === null || requested < 0 || requested > MAX_SEMANTIC_WAIT_MS) {
            return sanitizedFailure(
              "POLICY_BLOCKED",
              `semantic wait must be between 0 and ${MAX_SEMANTIC_WAIT_MS} milliseconds`,
              node.id,
              false,
            );
          }
          await this.page.waitForTimeout(
            Math.min(requested, remainingMs(deadlineMs)),
          );
          return await this.success(node, { value: true }, "semantic-wait", true);
        }
        default:
          return sanitizedFailure(
            "POLICY_BLOCKED",
            `semantic action '${decision.action}' is not a supported browser primitive`,
            node.id,
            false,
          );
      }
    } catch (error) {
      if (error instanceof ClassifiedExecutionError) throw error;
      if (isClosed(error) || isTimeout(error)) {
        throw classifiedFailure(
          "TRANSIENT_NETWORK",
          "browser session was unavailable during semantic execution",
          node.id,
          true,
          error,
        );
      }
      throw classifiedFailure(
        "UNKNOWN",
        "semantic browser execution failed",
        node.id,
        false,
        error,
      );
    }
  }

  private async navigate(
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const strategy = node.deterministicStrategies.find(
      (candidate) => candidate.kind === "URL",
    );
    const url = strategy?.value ?? primitiveString(inputs, ["url", "href"]);
    if (!url) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "navigation node has no deterministic URL",
        node.id,
        false,
      );
    }
    return this.navigateToUrl(node, url, deadlineMs, "navigate");
  }

  private async navigateToUrl(
    node: WorkflowNode,
    rawUrl: string,
    deadlineMs: number,
    evidenceKind: string,
  ): Promise<BrowserActionResult> {
    const url = safeHttpUrl(rawUrl);
    if (!url) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "browser navigation is restricted to HTTP and HTTPS URLs",
        node.id,
        false,
      );
    }
    const response = await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: remainingMs(deadlineMs),
    });
    if (response?.status() === 401) {
      return sanitizedFailure(
        "TARGET_AUTH_REQUIRED",
        "target website requires authentication",
        node.id,
        false,
      );
    }
    return this.success(node, { value: this.page.url() }, evidenceKind, true);
  }

  private async click(
    node: WorkflowNode,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const locator = await resolveNodeLocator(this.page, node, deadlineMs);
    if (!locator) return this.missingTarget(node, "click-missing");

    // Resolve first, click exactly once. Never fall through to another selector after
    // dispatching a side effect because that could duplicate an irreversible action.
    await locator.click({ timeout: remainingMs(deadlineMs) });
    return this.success(node, { value: true }, "click", true);
  }

  private async type(
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const value = primitiveString(inputs, ["value", "text", "input", "content"]);
    if (value === null) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "typing node has no bound input value",
        node.id,
        false,
      );
    }
    const locator = await resolveNodeLocator(this.page, node, deadlineMs);
    if (!locator) return this.missingTarget(node, "type-missing");
    await locator.fill(value, { timeout: remainingMs(deadlineMs) });

    // Do not capture a screenshot after typing. It may expose user-entered secrets
    // or private field contents in durable evidence. The transient typedValue output
    // is consumed only by verification; outputBindings are empty for captured TYPE.
    return this.success(node, { typedValue: value }, "type", false);
  }

  private async select(
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const value = primitiveString(inputs, ["value"]);
    if (value === null) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "select node has no bound option label",
        node.id,
        false,
      );
    }
    const locator = await resolveNodeLocator(this.page, node, deadlineMs);
    if (!locator) return this.missingTarget(node, "select-missing");
    const selectedValues = await locator.selectOption(
      { label: value },
      { timeout: remainingMs(deadlineMs) },
    );
    if (selectedValues.length !== 1 || selectedValues[0] === undefined) {
      return sanitizedFailure(
        "EFFECT_NOT_VERIFIED",
        "select node did not choose exactly one option",
        node.id,
        true,
      );
    }

    // The bound option can be private per-run data. Preserve only metadata evidence;
    // verification receives the transient selected value directly from this action result.
    return this.success(
      node,
      { selectedValue: selectedValues[0] },
      "select",
      false,
    );
  }

  private async check(
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const checked = primitiveBoolean(inputs, ["checked"]);
    if (checked === null) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "check node has no bound boolean state",
        node.id,
        false,
      );
    }
    const locator = await resolveNodeLocator(this.page, node, deadlineMs);
    if (!locator) return this.missingTarget(node, "check-missing");

    // Playwright check/uncheck is idempotent: a retry cannot reverse a state that was
    // already applied before an uncertain verification boundary.
    if (checked) {
      await locator.check({ timeout: remainingMs(deadlineMs) });
    } else {
      await locator.uncheck({ timeout: remainingMs(deadlineMs) });
    }
    const actualChecked = await locator.isChecked({ timeout: remainingMs(deadlineMs) });
    if (actualChecked !== checked) {
      return sanitizedFailure(
        "EFFECT_NOT_VERIFIED",
        "check node did not reach the bound checkbox state",
        node.id,
        true,
      );
    }

    // A checkbox can encode user/private form state. Keep evidence metadata-only.
    return this.success(node, { checked: actualChecked }, "check", false);
  }

  private async extract(
    node: WorkflowNode,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const locator = await resolveNodeLocator(this.page, node, deadlineMs);
    if (!locator) return this.missingTarget(node, "extract-missing");
    const value = (await locator.textContent({
      timeout: remainingMs(deadlineMs),
    })) ?? "";
    return this.success(node, { value }, "extract", true);
  }

  private async wait(
    node: WorkflowNode,
    inputs: Readonly<Record<string, unknown>>,
    deadlineMs: number,
  ): Promise<BrowserActionResult> {
    const hasLocatorStrategy = node.deterministicStrategies.some((strategy) =>
      ["ROLE", "TEXT", "TEST_ID", "CSS", "XPATH"].includes(strategy.kind),
    );
    if (hasLocatorStrategy) {
      const locator = await resolveNodeLocator(this.page, node, deadlineMs);
      if (!locator) return this.missingTarget(node, "wait-target-missing");
      return this.success(node, { value: true }, "wait-target", true);
    }

    const requested = primitiveNumber(inputs, ["milliseconds", "durationMs", "waitMs"]);
    const delayMs = requested === null ? Math.min(1_000, node.timeoutMs) : requested;
    if (delayMs < 0 || delayMs > node.timeoutMs) {
      return sanitizedFailure(
        "POLICY_BLOCKED",
        "wait duration must be non-negative and within the node timeout",
        node.id,
        false,
      );
    }
    await this.page.waitForTimeout(delayMs);
    return this.success(node, { value: true }, "wait", true);
  }

  private async noopForVerification(
    node: WorkflowNode,
  ): Promise<BrowserActionResult> {
    const stateFingerprint = await pageStateFingerprint(this.page);
    return {
      effectObserved: true,
      evidenceRefs: [],
      outputs: {},
      stateFingerprint,
    };
  }

  private async missingTarget(
    node: WorkflowNode,
    evidenceKind: string,
  ): Promise<BrowserActionResult> {
    const evidence = await this.evidence.record(
      this.page,
      node,
      evidenceKind,
      true,
    );
    const failure = sanitizedFailure(
      "ELEMENT_NOT_FOUND",
      "deterministic browser target was not found",
      node.id,
      true,
      evidence.evidenceRefs,
    );
    if (node.escalation !== "SEMANTIC_RECOVERY") return failure;
    const semanticObservation = await captureSemanticBrowserObservation(this.page, node);
    return { ...failure, semanticObservation };
  }

  private async success(
    node: WorkflowNode,
    outputs: Readonly<Record<string, unknown>>,
    evidenceKind: string,
    includeScreenshot: boolean,
  ): Promise<BrowserActionResult> {
    const evidence = await this.evidence.record(
      this.page,
      node,
      evidenceKind,
      includeScreenshot,
    );
    return {
      effectObserved: true,
      evidenceRefs: evidence.evidenceRefs,
      outputs,
      stateFingerprint: evidence.stateFingerprint,
    };
  }
}

export class AgentCorePlaywrightVerificationEngine
  implements VerificationEngine
{
  constructor(
    private readonly page: Page,
    private readonly evidence: PlaywrightEvidenceRecorder,
  ) {}

  async verify(context: VerificationContext): Promise<VerificationResult> {
    const expected = context.verification.expected;
    let verified = false;
    let detail: string;

    try {
      switch (context.verification.mode) {
        case "URL":
          verified = Boolean(expected) && this.page.url().includes(expected ?? "");
          detail = verified
            ? "URL verification passed"
            : "URL verification failed";
          break;
        case "TEXT":
          verified = Boolean(expected) &&
            (await this.page
              .getByText(expected ?? "", { exact: false })
              .first()
              .isVisible({ timeout: context.verification.timeoutMs }));
          detail = verified
            ? "text verification passed"
            : "text verification failed";
          break;
        case "DOM":
          verified = Boolean(expected) &&
            (await this.page
              .locator(expected ?? "")
              .first()
              .isVisible({ timeout: context.verification.timeoutMs }));
          detail = verified
            ? "DOM verification passed"
            : "DOM verification failed";
          break;
        case "CUSTOM": {
          const result = await verifyCaptureCustomState(
            this.page,
            context.node,
            expected,
            context.verification.timeoutMs,
            context.outputs,
          );
          verified = result.verified;
          detail = result.detail;
          break;
        }
        case "MODEL":
          throw classifiedFailure(
            "NOT_CONFIGURED",
            "MODEL verification requires an explicit verifier adapter",
            context.node.id,
            false,
          );
      }

      const evidence = await this.evidence.record(
        this.page,
        context.node,
        verified ? "verify-passed" : "verify-failed",
        context.node.kind !== "TYPE" && context.node.kind !== "SELECT" && context.node.kind !== "CHECK",
      );
      return {
        verified,
        evidenceRefs: evidence.evidenceRefs,
        detail,
      };
    } catch (error) {
      if (error instanceof ClassifiedExecutionError) throw error;
      if (isClosed(error) || isTimeout(error)) {
        throw classifiedFailure(
          "TRANSIENT_NETWORK",
          "browser verification could not inspect the page",
          context.node.id,
          true,
          error,
        );
      }
      throw classifiedFailure(
        "UNKNOWN",
        "browser verification failed",
        context.node.id,
        false,
        error,
      );
    }
  }
}

export class AgentCorePlaywrightRuntimeFactory
  implements BrowserExecutionRuntimeFactory
{
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  ) {
    if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1) {
      throw new Error("Playwright connect timeout must be a positive integer");
    }
  }

  async create(
    scope: OwnershipScope,
    run: RunRecord,
    session: BrowserSessionHandle,
  ): Promise<BrowserExecutionRuntime> {
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
    try {
      browser = await chromium.connectOverCDP(session.connection.endpoint, {
        headers: { ...session.connection.headers },
        timeout: this.connectTimeoutMs,
      });
    } catch (error) {
      throw connectionFailure(error);
    }

    try {
      const context = browser.contexts()[0];
      if (!context) {
        throw new Error("AgentCore Browser CDP connection has no default context");
      }
      const page = context.pages()[0] ?? (await context.newPage());
      const evidence = new PlaywrightEvidenceRecorder(
        this.artifacts,
        scope,
        run.runId,
      );
      return {
        browser: new AgentCorePlaywrightBrowserExecutor(page, evidence),
        verifier: new AgentCorePlaywrightVerificationEngine(page, evidence),
        close: async () => {
          await browser.close();
        },
      };
    } catch (error) {
      try {
        await browser.close();
      } catch {
        // Preserve the setup error; the outer worker still stops the AgentCore session.
      }
      if (error instanceof ClassifiedExecutionError) throw error;
      throw classifiedFailure(
        "UNKNOWN",
        "AgentCore Browser Playwright runtime setup failed",
        "browser-session",
        false,
        error,
      );
    }
  }
}
