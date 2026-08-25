import { describe, expect, it } from "vitest";
import { buildRunTimeline, runTimelineStateLabel } from "./run-timeline";

describe("run execution timeline", () => {
  it("orders durable completed steps before the current step", () => {
    const timeline = buildRunTimeline({
      completed: [
        { step: 1, kind: "NAVIGATE", objective: "Open the form" },
        { step: 2, kind: "TYPE", objective: "Fill the approved value" },
      ],
      current: { step: 3, kind: "CLICK", objective: "Submit the form" },
    });

    expect(timeline).toEqual([
      { step: 1, kind: "NAVIGATE", objective: "Open the form", state: "COMPLETED" },
      { step: 2, kind: "TYPE", objective: "Fill the approved value", state: "COMPLETED" },
      { step: 3, kind: "CLICK", objective: "Submit the form", state: "CURRENT" },
    ]);
  });

  it("uses the failed semantic step as the active timeline outcome", () => {
    const timeline = buildRunTimeline({
      completed: [{ step: 1, kind: "NAVIGATE", objective: "Open the form" }],
      current: { step: 2, kind: "CLICK", objective: "Submit the form" },
      failure: { step: 2, kind: "CLICK", objective: "Submit the form" },
    });

    expect(timeline).toEqual([
      { step: 1, kind: "NAVIGATE", objective: "Open the form", state: "COMPLETED" },
      { step: 2, kind: "CLICK", objective: "Submit the form", state: "FAILED" },
    ]);
    expect(runTimelineStateLabel("FAILED")).toBe("Failed / needs attention");
  });

  it("preserves repeated semantic steps so loop progress is not invented or deduplicated", () => {
    const timeline = buildRunTimeline({
      completed: [
        { step: 2, kind: "CLICK", objective: "Check the next item" },
        { step: 2, kind: "CLICK", objective: "Check the next item" },
      ],
      current: { step: 3, kind: "VERIFY", objective: "Verify the result" },
    });

    expect(timeline.map((entry) => entry.step)).toEqual([2, 2, 3]);
    expect(timeline.map((entry) => entry.state)).toEqual(["COMPLETED", "COMPLETED", "CURRENT"]);
  });

  it("returns no timeline when immutable semantic workflow metadata is unavailable", () => {
    expect(buildRunTimeline(undefined)).toEqual([]);
  });
});
