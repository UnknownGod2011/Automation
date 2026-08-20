import { describe, expect, it } from "vitest";
import { AwsSesNotificationPort } from "./ses-notification.js";

const scope = { tenantId: "tenant-1", userId: "user-1" } as const;

const message = {
  kind: "RUN_FAILED" as const,
  recipientUserId: "user-1",
  automationId: "auto-1",
  runId: "run-1",
  subject: "Automation failed",
  body: "Run run-1 failed with code UNKNOWN",
};

describe("AwsSesNotificationPort", () => {
  it("resolves the destination from trusted ownership rather than the run command", async () => {
    const sent: unknown[] = [];
    const notifications = new AwsSesNotificationPort(
      { fromEmail: "automation@example.com" },
      { async sendEmail(request) { sent.push(request); } },
      {
        async resolve(observedScope, userId) {
          expect(observedScope).toEqual(scope);
          expect(userId).toBe("user-1");
          return { email: "owner@example.com" };
        },
      },
    );

    await notifications.send(scope, message);

    expect(sent).toEqual([{
      from: "automation@example.com",
      to: "owner@example.com",
      subject: "Automation failed",
      textBody: "Run run-1 failed with code UNKNOWN",
    }]);
  });

  it("rejects cross-user routing before recipient lookup or SES delivery", async () => {
    let calls = 0;
    const notifications = new AwsSesNotificationPort(
      { fromEmail: "automation@example.com" },
      { async sendEmail() { calls += 1; } },
      { async resolve() { calls += 1; return { email: "owner@example.com" }; } },
    );

    await expect(notifications.send(scope, { ...message, recipientUserId: "user-2" }))
      .rejects.toThrow("outside ownership scope");
    expect(calls).toBe(0);
  });

  it("fails closed for missing or malformed destination addresses", async () => {
    const missing = new AwsSesNotificationPort(
      { fromEmail: "automation@example.com" },
      { async sendEmail() { throw new Error("should not send"); } },
      { async resolve() { return null; } },
    );
    await expect(missing.send(scope, message)).rejects.toThrow("recipient is not configured");

    const malformed = new AwsSesNotificationPort(
      { fromEmail: "automation@example.com" },
      { async sendEmail() { throw new Error("should not send"); } },
      { async resolve() { return { email: "not-an-email" }; } },
    );
    await expect(malformed.send(scope, message)).rejects.toThrow("email address is invalid");
  });
});
