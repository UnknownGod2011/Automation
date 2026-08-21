import type { AutomationSummaryView, ControlPlaneCapabilities, RunSummaryView } from "@automation/core";

export function formatCapability(label: string, state: ControlPlaneCapabilities[keyof ControlPlaneCapabilities]): string {
  return `${label}: ${state === "NOT_CONFIGURED" ? "Not configured" : state === "LOCAL_MOCK" ? "Local mock" : "Configured"}`;
}

export function formatSchedule(automation: AutomationSummaryView): string {
  const schedule = automation.schedule;
  if (!schedule) return "Not published";
  return `${schedule.kind.toLowerCase()} · ${schedule.expression} · ${schedule.timezone}`;
}

export function runTone(status: RunSummaryView["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "WAITING_FOR_HUMAN") return "warning";
  if (status === "FAILED" || status === "CANCELED") return "danger";
  return "neutral";
}

export function runKindLabel(run: Pick<RunSummaryView, "runKind">): string {
  if (run.runKind === "FRESH_TEST") return "Fresh test";
  if (run.runKind === "SCHEDULED") return "Scheduled run";
  return "Run";
}

export type FreshTestFeedback =
  | { kind: "NONE" }
  | { kind: "RUNNING" | "PASSED" | "NEEDS_ATTENTION" | "NEEDS_CORRECTION"; run: RunSummaryView };

export function latestFreshTestFeedback(runs: readonly RunSummaryView[]): FreshTestFeedback {
  const latest = [...runs]
    .filter((run) => run.runKind === "FRESH_TEST")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];

  if (!latest) return { kind: "NONE" };
  if (latest.status === "SUCCEEDED") return { kind: "PASSED", run: latest };
  if (latest.status === "WAITING_FOR_HUMAN") return { kind: "NEEDS_ATTENTION", run: latest };
  if (latest.status === "FAILED" || latest.status === "CANCELED" || latest.status === "SKIPPED") {
    return { kind: "NEEDS_CORRECTION", run: latest };
  }
  return { kind: "RUNNING", run: latest };
}

export function automationPhase(automation: AutomationSummaryView): string {
  if (automation.needsAttention) return "Needs attention";
  if (automation.status === "ACTIVE") return "Published";
  if (automation.publishedWorkflowVersion !== undefined) return "Published";
  return "Draft";
}
