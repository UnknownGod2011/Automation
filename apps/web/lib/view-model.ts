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

export function automationPhase(automation: AutomationSummaryView): string {
  if (automation.needsAttention) return "Needs attention";
  if (automation.status === "ACTIVE") return "Published";
  if (automation.publishedWorkflowVersion !== undefined) return "Published";
  return "Draft";
}
