import { describe, expect, it } from "vitest";
import type { AutomationRecord } from "@automation/contracts";
import { InMemoryCaptureSessionStore, type OwnershipScope } from "@automation/core";
import {
  AgentCoreCaptureSessionStarter,
  type AgentCoreBrowserLiveViewSigner,
} from "./capture-session.js";
import type { AgentCoreBrowserDataApi } from "./browser-session.js";

const scope: OwnershipScope = { tenantId: "tenant-author", userId: "user-author" };

function automation(status: AutomationRecord["status"]): AutomationRecord {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    automationId: "automation-authoring",
    name: "Authoring example",
    websiteUrl: "https://example.test/app",
    prompt: "Submit the approved form",
    status,
    browserProfileRef: "aws-agentcore-browser-profile://profileA-1234567890",
    notifyOnSuccess: false,
    notifyOnFailure: true,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...(status === "ACTIVE"
      ? {
          publishedWorkflowVersion: 1,
          schedule: { kind: "DAILY" as const, expression: "cron(0 9 * * ? *)", timezone: "UTC" },
        }
      : {}),
  };
}

describe("AgentCoreCaptureSessionStarter workflow-authoring gate", () => {
  it("rejects an active published automation before allocating AgentCore Browser compute", async () => {
    let starts = 0;
    let signs = 0;
    const api: AgentCoreBrowserDataApi = {
      async start() {
        starts += 1;
        return { sessionId: "session1" };
      },
      async save() {},
      async stop() {},
    };
    const signer: AgentCoreBrowserLiveViewSigner = {
      async sign() {
        signs += 1;
        return "https://bedrock-agentcore.us-east-1.amazonaws.com/live";
      },
    };
    const starter = new AgentCoreCaptureSessionStarter(api, signer, "browser-custom", {
      sessionStore: new InMemoryCaptureSessionStore(),
      captureId: () => "capture-authoring",
    });

    await expect(starter.start(scope, automation("ACTIVE"))).rejects.toThrow(
      "pre-publish workflow-authoring state",
    );
    expect(starts).toBe(0);
    expect(signs).toBe(0);
  });

  it("keeps draft capture available", async () => {
    let starts = 0;
    const api: AgentCoreBrowserDataApi = {
      async start() {
        starts += 1;
        return { sessionId: "session1" };
      },
      async save() {},
      async stop() {},
    };
    const signer: AgentCoreBrowserLiveViewSigner = {
      async sign() {
        return "https://bedrock-agentcore.us-east-1.amazonaws.com/live";
      },
    };
    const starter = new AgentCoreCaptureSessionStarter(api, signer, "browser-custom", {
      sessionStore: new InMemoryCaptureSessionStore(),
      captureId: () => "capture-authoring",
      now: () => new Date("2026-08-23T00:00:00.000Z"),
    });

    await expect(starter.start(scope, automation("DRAFT"))).resolves.toMatchObject({
      kind: "READY",
      captureSessionId: "capture-authoring",
    });
    expect(starts).toBe(1);
  });
});
