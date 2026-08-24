import { describe, expect, it, vi } from "vitest";
import { InMemoryCaptureSessionStore } from "./capture-completion.js";
import { AutomationControlPlaneHttpHandler } from "./control-plane-http.js";
import {
  AutomationControlPlaneService,
  type AutomationLifecyclePort,
  type CaptureSessionStarter,
} from "./control-plane.js";
import { InMemoryAutomationRepository, InMemoryRunRepository } from "./memory.js";

function lifecycle(): AutomationLifecyclePort {
  return {
    createDraft: vi.fn(async () => { throw new Error("unexpected create"); }),
    persistCapture: vi.fn(async () => { throw new Error("unexpected capture persistence"); }),
    compile: vi.fn(async () => { throw new Error("unexpected compile"); }),
    runFreshTest: vi.fn(async () => { throw new Error("unexpected local fresh test"); }),
    publish: vi.fn(async () => { throw new Error("unexpected publish"); }),
    history: vi.fn(async () => []),
  };
}

function service(): AutomationControlPlaneService {
  const captureSessions: CaptureSessionStarter = {
    start: vi.fn(async () => ({ kind: "NOT_CONFIGURED" as const, reason: "capture unavailable" })),
  };
  return new AutomationControlPlaneService({
    automations: new InMemoryAutomationRepository(),
    runs: new InMemoryRunRepository(),
    lifecycle: lifecycle(),
    captureSessions,
    captureState: new InMemoryCaptureSessionStore(),
    capabilities: {
      auth: "LOCAL_MOCK",
      capture: "LOCAL_MOCK",
      cloudExecution: "LOCAL_MOCK",
      scheduling: "LOCAL_MOCK",
      notifications: "LOCAL_MOCK",
    },
  });
}

describe("authenticated control-plane Fresh Test identity", () => {
  it("mints the run identity server-side and ignores a caller-supplied runId", async () => {
    const controlPlane = service();
    const submit = vi.spyOn(controlPlane, "runFreshTest").mockResolvedValue({
      kind: "ACCEPTED",
      runId: "test-server-generated",
    });
    const handler = new AutomationControlPlaneHttpHandler(
      controlPlane,
      () => "test-server-generated",
    );

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/test",
        body: {
          runId: "test-caller-controlled",
          tenantId: "tenant-attacker",
          userId: "user-attacker",
          runtimeVariables: { capture_input_1: "public demo value" },
        },
      },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response).toEqual({
      status: 200,
      body: { kind: "ACCEPTED", runId: "test-server-generated" },
    });
    expect(submit).toHaveBeenCalledWith(
      { tenantId: "tenant-owner", userId: "user-owner" },
      "auto-1",
      {
        runId: "test-server-generated",
        runtimeVariables: { capture_input_1: "public demo value" },
      },
    );
    expect(JSON.stringify(response.body)).not.toContain("test-caller-controlled");
  });

  it("does not require a runId in the authenticated request body", async () => {
    const controlPlane = service();
    const submit = vi.spyOn(controlPlane, "runFreshTest").mockResolvedValue({
      kind: "ACCEPTED",
      runId: "test-server-generated-2",
    });
    const handler = new AutomationControlPlaneHttpHandler(
      controlPlane,
      () => "test-server-generated-2",
    );

    const response = await handler.handle(
      {
        method: "POST",
        path: "/v1/automations/auto-1/test",
        body: {},
      },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response.status).toBe(200);
    expect(submit).toHaveBeenCalledWith(
      { tenantId: "tenant-owner", userId: "user-owner" },
      "auto-1",
      { runId: "test-server-generated-2" },
    );
  });

  it("fails closed before execution submission when the server identity factory is invalid", async () => {
    const controlPlane = service();
    const submit = vi.spyOn(controlPlane, "runFreshTest").mockResolvedValue({
      kind: "ACCEPTED",
      runId: "unused",
    });
    const handler = new AutomationControlPlaneHttpHandler(controlPlane, () => "caller shaped value");

    const response = await handler.handle(
      { method: "POST", path: "/v1/automations/auto-1/test", body: {} },
      { scope: { tenantId: "tenant-owner", userId: "user-owner" } },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: {
          code: "CONFLICT",
          message: "fresh-test run identity could not be generated",
        },
      },
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
