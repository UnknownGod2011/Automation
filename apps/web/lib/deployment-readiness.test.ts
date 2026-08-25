import { describe, expect, it } from "vitest";
import type { ControlPlaneCapabilities } from "@automation/core";
import {
  PRODUCTION_CAPABILITY_ORDER,
  productionDeploymentReadiness,
} from "./deployment-readiness.js";

const configured: ControlPlaneCapabilities = {
  auth: "CONFIGURED",
  capture: "CONFIGURED",
  cloudExecution: "CONFIGURED",
  scheduling: "CONFIGURED",
  notifications: "CONFIGURED",
};

describe("production deployment readiness", () => {
  it("is ready only when every production capability is configured", () => {
    const result = productionDeploymentReadiness(configured);

    expect(result.kind).toBe("READY");
    expect(result.capabilities.map((capability) => capability.key)).toEqual(PRODUCTION_CAPABILITY_ORDER);
    expect(result.capabilities.every((capability) => capability.ready)).toBe(true);
    expect(result.capabilities.every((capability) => capability.message === "Configured for production.")).toBe(true);
  });

  it("treats local/mock capability state as incomplete for a production deployment", () => {
    const result = productionDeploymentReadiness({
      ...configured,
      cloudExecution: "LOCAL_MOCK",
    });

    expect(result.kind).toBe("INCOMPLETE");
    expect(result.capabilities.find((capability) => capability.key === "cloudExecution")).toMatchObject({
      state: "LOCAL_MOCK",
      ready: false,
      message: "Local/mock only; production cloud behavior is not enabled.",
    });
  });

  it("surfaces every explicitly unconfigured capability without inventing readiness", () => {
    const result = productionDeploymentReadiness({
      auth: "CONFIGURED",
      capture: "NOT_CONFIGURED",
      cloudExecution: "CONFIGURED",
      scheduling: "NOT_CONFIGURED",
      notifications: "NOT_CONFIGURED",
    });

    expect(result.kind).toBe("INCOMPLETE");
    expect(result.capabilities.filter((capability) => !capability.ready).map((capability) => capability.key)).toEqual([
      "capture",
      "scheduling",
      "notifications",
    ]);
    expect(result.capabilities.filter((capability) => capability.state === "NOT_CONFIGURED").every(
      (capability) => capability.message === "Not configured for this deployment.",
    )).toBe(true);
  });
});
