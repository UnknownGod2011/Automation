import type { CaptureRecordingView } from "@automation/core";

export type CaptureRecordingMutation = "record-workflow" | "finish-capture";

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
