import { describe, expect, it } from "vitest";
import { serverResolvedCaptureSessionId } from "./capture-command-state";

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
