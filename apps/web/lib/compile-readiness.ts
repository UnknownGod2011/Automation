import type { AutomationSummaryView } from "@automation/core";

export type CompileCapturePresentation =
  | { kind: "READY"; completedAt: string }
  | { kind: "WAITING"; message: string };

export function compileCapturePresentation(
  automation: Pick<AutomationSummaryView, "status" | "latestCompletedCapture">,
): CompileCapturePresentation {
  if (automation.status === "COMPILING" && automation.latestCompletedCapture) {
    return { kind: "READY", completedAt: automation.latestCompletedCapture.completedAt };
  }

  if (automation.status === "COMPILING") {
    return {
      kind: "WAITING",
      message: "Capture completion is not ready for compilation yet. Refresh after the trusted capture worker finishes.",
    };
  }

  if (
    automation.status === "READY_TO_TEST" ||
    automation.status === "TESTING" ||
    automation.status === "READY_TO_PUBLISH"
  ) {
    return {
      kind: "WAITING",
      message: "The latest capture is already compiled. Review the semantic plan and continue with Fresh Test or correction.",
    };
  }

  if (automation.latestCompletedCapture) {
    return {
      kind: "WAITING",
      message: "A previous capture is retained for history, but it is not currently eligible for compilation. Start the supported revision flow before compiling a replacement.",
    };
  }

  return {
    kind: "WAITING",
    message: "Finish a cloud capture first. Once the trusted capture worker saves the Browser Profile and trace, this step becomes ready automatically.",
  };
}

export function canCompileLatestCapture(
  automation: Pick<AutomationSummaryView, "status" | "latestCompletedCapture">,
): boolean {
  return compileCapturePresentation(automation).kind === "READY";
}
