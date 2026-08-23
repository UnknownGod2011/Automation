import { describe, expect, it } from "vitest";
import { canCompileLatestCapture, compileCapturePresentation } from "./compile-readiness";

const completed = { completedAt: "2026-08-23T12:00:00.000Z" };

describe("compileCapturePresentation", () => {
  it("allows compilation only while durable automation state is COMPILING with a completed capture", () => {
    expect(compileCapturePresentation({ status: "COMPILING", latestCompletedCapture: completed })).toEqual({
      kind: "READY",
      completedAt: completed.completedAt,
    });
    expect(canCompileLatestCapture({ status: "COMPILING", latestCompletedCapture: completed })).toBe(true);
  });

  it("does not advertise a second compile after the capture already produced a workflow", () => {
    for (const status of ["READY_TO_TEST", "TESTING", "READY_TO_PUBLISH"] as const) {
      const result = compileCapturePresentation({ status, latestCompletedCapture: completed });
      expect(result.kind).toBe("WAITING");
      expect(result.kind === "WAITING" ? result.message : "").toContain("already compiled");
      expect(canCompileLatestCapture({ status, latestCompletedCapture: completed })).toBe(false);
    }
  });

  it("fails closed when COMPILING state has no authoritative completed capture", () => {
    const result = compileCapturePresentation({ status: "COMPILING" });
    expect(result.kind).toBe("WAITING");
    expect(canCompileLatestCapture({ status: "COMPILING" })).toBe(false);
  });

  it("keeps retained historical captures non-compilable outside the authoring transition", () => {
    for (const status of ["ACTIVE", "PAUSED", "DISABLED"] as const) {
      const result = compileCapturePresentation({ status, latestCompletedCapture: completed });
      expect(result.kind).toBe("WAITING");
      expect(canCompileLatestCapture({ status, latestCompletedCapture: completed })).toBe(false);
    }
  });
});
