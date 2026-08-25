import type { ControlPlaneCapabilities, ControlPlaneCapabilityState } from "@automation/core";

export const PRODUCTION_CAPABILITY_ORDER = [
  "auth",
  "capture",
  "cloudExecution",
  "scheduling",
  "notifications",
] as const satisfies readonly (keyof ControlPlaneCapabilities)[];

export type ProductionCapabilityKey = (typeof PRODUCTION_CAPABILITY_ORDER)[number];

export interface DeploymentCapabilityPresentation {
  key: ProductionCapabilityKey;
  label: string;
  state: ControlPlaneCapabilityState;
  ready: boolean;
  message: string;
}

export interface DeploymentReadinessPresentation {
  kind: "READY" | "INCOMPLETE";
  capabilities: readonly DeploymentCapabilityPresentation[];
}

const LABELS: Record<ProductionCapabilityKey, string> = {
  auth: "Authentication",
  capture: "Cloud capture",
  cloudExecution: "Cloud execution",
  scheduling: "Scheduling",
  notifications: "Notifications",
};

function capabilityMessage(state: ControlPlaneCapabilityState): string {
  if (state === "CONFIGURED") return "Configured for production.";
  if (state === "LOCAL_MOCK") return "Local/mock only; production cloud behavior is not enabled.";
  return "Not configured for this deployment.";
}

export function productionDeploymentReadiness(
  capabilities: ControlPlaneCapabilities,
): DeploymentReadinessPresentation {
  const presented = PRODUCTION_CAPABILITY_ORDER.map((key) => ({
    key,
    label: LABELS[key],
    state: capabilities[key],
    ready: capabilities[key] === "CONFIGURED",
    message: capabilityMessage(capabilities[key]),
  }));

  return {
    kind: presented.every((capability) => capability.ready) ? "READY" : "INCOMPLETE",
    capabilities: presented,
  };
}
