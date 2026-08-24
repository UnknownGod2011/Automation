import { describe, expect, it } from "vitest";
import { captureLaunchPresentation } from "./capture-command-state";

describe("captureLaunchPresentation", () => {
  it("allows launch only in core-authorized workflow authoring states", () => {
    expect(captureLaunchPresentation("DRAFT", { kind: "NONE" }).kind).toBe("START");
    expect(captureLaunchPresentation("READY_TO_PUBLISH", { kind: "NONE" }).kind).toBe("START");
    expect(captureLaunchPresentation("DISABLED", { kind: "NONE" })).toEqual({
      kind: "START",
      message: "This disabled automation is safe to revise. Start a new capture to teach its replacement workflow.",
    });
  });

  it("suppresses a second launch while an authoritative capture is active", () => {
    const result = captureLaunchPresentation("DRAFT", {
      kind: "ACTIVE",
      phase: "AUTH_SETUP",
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    });
    expect(result.kind).toBe("ACTIVE");
  });

  it("requires disablement before revising a published schedule", () => {
    expect(captureLaunchPresentation("ACTIVE", { kind: "NONE" }).kind).toBe("DISABLE_FIRST");
    expect(captureLaunchPresentation("PAUSED", { kind: "NONE" }).kind).toBe("DISABLE_FIRST");
  });

  it("blocks capture during execution and human-attention states", () => {
    expect(captureLaunchPresentation("RUNNING", { kind: "NONE" }).kind).toBe("BLOCKED");
    expect(captureLaunchPresentation("NEEDS_AUTH", { kind: "NONE" }).kind).toBe("BLOCKED");
    expect(captureLaunchPresentation("NEEDS_API_KEY", { kind: "NONE" }).kind).toBe("BLOCKED");
    expect(captureLaunchPresentation("NEEDS_ATTENTION", { kind: "NONE" }).kind).toBe("BLOCKED");
  });

  it("blocks overlapping capture/compile/test lifecycle phases", () => {
    expect(captureLaunchPresentation("CAPTURING", { kind: "NONE" }).kind).toBe("BLOCKED");
    expect(captureLaunchPresentation("TESTING", { kind: "NONE" }).kind).toBe("BLOCKED");
  });
});
