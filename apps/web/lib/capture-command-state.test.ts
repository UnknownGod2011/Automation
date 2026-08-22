import { describe, expect, it } from "vitest";
import { captureLaunchPresentation, serverResolvedCaptureSessionId } from "./capture-command-state";

describe("serverResolvedCaptureSessionId", () => {
  it("rejects capture mutations when there is no active capture", () => {
    expect(serverResolvedCaptureSessionId({ kind: "NONE" }, "record-workflow")).toBeNull();
    expect(serverResolvedCaptureSessionId({ kind: "NONE" }, "finish-capture")).toBeNull();
  });

  it("resolves start from trusted active AUTH_SETUP state", () => {
    expect(serverResolvedCaptureSessionId({
      kind: "ACTIVE",
      captureSessionId: "capture-123",
      phase: "AUTH_SETUP",
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    }, "record-workflow")).toBe("capture-123");
  });

  it("does not allow finish before workflow recording has started", () => {
    expect(serverResolvedCaptureSessionId({
      kind: "ACTIVE",
      captureSessionId: "capture-123",
      phase: "AUTH_SETUP",
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    }, "finish-capture")).toBeNull();
  });

  it("keeps duplicate start and finish delivery replay-safe", () => {
    const recording = {
      kind: "ACTIVE" as const,
      captureSessionId: "capture-123",
      phase: "WORKFLOW" as const,
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    };
    expect(serverResolvedCaptureSessionId(recording, "record-workflow")).toBe("capture-123");
    expect(serverResolvedCaptureSessionId(recording, "finish-capture")).toBe("capture-123");
    expect(serverResolvedCaptureSessionId({ ...recording, finishRequested: true }, "record-workflow")).toBeNull();
    expect(serverResolvedCaptureSessionId({ ...recording, finishRequested: true }, "finish-capture")).toBe("capture-123");
  });

  it("fails closed on malformed server capture identities", () => {
    expect(serverResolvedCaptureSessionId({
      kind: "ACTIVE",
      captureSessionId: "   ",
      phase: "WORKFLOW",
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    }, "finish-capture")).toBeNull();
    expect(serverResolvedCaptureSessionId({
      kind: "ACTIVE",
      captureSessionId: "x".repeat(161),
      phase: "WORKFLOW",
      finishRequested: false,
      expiresAt: "2026-08-22T03:00:00.000Z",
    }, "finish-capture")).toBeNull();
  });
});

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
      captureSessionId: "capture-123",
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
