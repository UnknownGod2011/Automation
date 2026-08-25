import type {
  AutomationSummaryView,
  CaptureRecordingView,
  RunSummaryView,
  WorkflowInspectionView,
} from "@automation/core";
import { WebControlPlaneError } from "./control-plane-client";

export interface AutomationDetailReadClient {
  automation(automationId: string): Promise<AutomationSummaryView>;
  runs(automationId: string): Promise<readonly RunSummaryView[]>;
  captureRecording(automationId: string): Promise<CaptureRecordingView>;
  workflow(automationId: string): Promise<WorkflowInspectionView | null>;
}

export interface AutomationDetailReadResult {
  automation: AutomationSummaryView;
  runs: readonly RunSummaryView[];
  captureRecording: CaptureRecordingView;
  workflowInspection: WorkflowInspectionView | null;
  runHistoryUnavailable: boolean;
}

async function readRunsFailSoft(
  client: AutomationDetailReadClient,
  automationId: string,
): Promise<{ runs: readonly RunSummaryView[]; unavailable: boolean }> {
  try {
    return { runs: await client.runs(automationId), unavailable: false };
  } catch (error) {
    if (error instanceof WebControlPlaneError && error.code === "CONFLICT") {
      return { runs: [], unavailable: true };
    }
    throw error;
  }
}

export async function loadAutomationDetail(
  client: AutomationDetailReadClient,
  automationId: string,
): Promise<AutomationDetailReadResult> {
  const automation = await client.automation(automationId);
  const [history, captureRecording, workflowInspection] = await Promise.all([
    readRunsFailSoft(client, automationId),
    client.captureRecording(automationId),
    client.workflow(automationId),
  ]);

  return {
    automation,
    runs: history.runs,
    captureRecording,
    workflowInspection,
    runHistoryUnavailable: history.unavailable,
  };
}
