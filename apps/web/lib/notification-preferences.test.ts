import { describe, expect, it } from "vitest";
import { notificationPreferenceCopy } from "./notification-preferences";

describe("notification preference product copy", () => {
  it("keeps ordinary failure opt-out separate from mandatory human-attention notification", () => {
    const copy = notificationPreferenceCopy();

    expect(copy.failure).toBe("Notify me when a run fails.");
    expect(copy.attention).toContain("always notify");
    expect(copy.attention).toContain("human attention");
    expect(copy.success).toContain("successful runs");
  });
});
