import {
  canAuthorWorkflowCapture,
  type AutomationSummaryView,
  type CaptureRecordingView,
} from "@automation/core";

export type CaptureRecordingMutation = "record-workflow" | "finish-capture";

export type CaptureLaunchPresentation =
  | { kind: "START"; message: string }
  | { kind: "ACTIVE"; message: string }
  | { kind: "DISABLE_FIRST"; message: string }
  | { kind: "BLOCKED"; message: string };

/**
 * Resolve the active capture-session identity from authenticated control-plane state.
 * Browser form fields are intentionally not an authority for this identifier.
 */
export function serverResolvedCaptureSessionId(
  recording: CaptureRecordingView,
  command: CaptureRecordingMutation,
): string | null {
  if (recording.kind !== "ACTIVE") return null;

  const captureSessionId = recording.captureSessionId.trim();
  if (!captureSessionId || captureSessionId.length > 160) return null;

  if (command === "record-workflow") {
    // Start is replay-safe while WORKFLOW is already active, but must not restart a
    // capture after finish has been requested.
    return recording.finishRequested ? null : captureSessionId;
  }

  // Finishing before the durable WORKFLOW phase would accidentally treat auth setup
  // as the demonstrated workflow. Exact finish replay remains allowed.
  return recording.phase === "WORKFLOW" ? captureSessionId : null;
}

/**
 * Product-facing capture launch state. This deliberately delegates authoring eligibility
 * to the provider-neutral core policy so the UI cannot drift from the server lifecycle.
 * An existing durable capture always wins over lifecycle authoring eligibility.
 */
export function captureLaunchPresentation(
  status: AutomationSummaryView["status"],
  recording: CaptureRecordingView,
): CaptureLaunchPresentation {
  if (recording.kind === "ACTIVE") {
    return {
      kind: "ACTIVE",
      message: "A cloud capture is already active. Continue or cancel it before starting another.",
    };
  }

  if (canAuthorWorkflowCapture(status)) {
    return {
      kind: "START",
      message: status === "DISABLED"
        ? "This disabled automation is safe to revise. Start a new capture to teach its replacement workflow."
        : "No active capture session. Starting a cloud capture creates durable recording-control state.",
    };
  }

  if (status === "ACTIVE" || status === "PAUSED") {
    return {
      kind: "DISABLE_FIRST",
      message: "Disable this published automation before teaching a replacement workflow. Pausing alone does not reopen authoring.",
    };
  }

  if (status === "RUNNING") {
    return {
      kind: "BLOCKED",
      message: "A run is currently in progress. Let it finish or resolve it before disabling and revising the workflow.",
    };
  }

  if (status === "NEEDS_AUTH" || status === "NEEDS_API_KEY" || status === "NEEDS_ATTENTION") {
    return {
      kind: "BLOCKED",
      message: "Resolve the current attention state before changing the workflow. Repair and revision are separate safety boundaries.",
    };
  }

  return {
    kind: "BLOCKED",
    message: "Finish the current capture, compile, or test step before starting another workflow capture.",
  };
}
