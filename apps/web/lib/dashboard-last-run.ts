import type { RunSummaryView } from "@automation/core";
import { runHistoryStatusDetail, runKindLabel, runTone } from "./view-model.js";

export interface DashboardLastRunPresentation {
  kind: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "neutral";
}

export function dashboardLastRunPresentation(run: RunSummaryView): DashboardLastRunPresentation {
  return {
    kind: runKindLabel(run),
    detail: runHistoryStatusDetail(run),
    tone: runTone(run.status),
  };
}
