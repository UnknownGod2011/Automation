import { describe, expect, it } from "vitest";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { AwsSesV2SendEmailTransport } from "./ses-sdk.js";

describe("AwsSesV2SendEmailTransport", () => {
  it("maps sanitized notification content to one SES v2 SendEmail command", async () => {
    const commands: SendEmailCommand[] = [];
    const transport = new AwsSesV2SendEmailTransport("ap-south-1", {
      async send(command) {
        commands.push(command);
        return {};
      },
    });

    await transport.sendEmail({
      from: "automation@example.com",
      to: "owner@example.com",
      subject: "Automation needs attention",
      textBody: "Run run-1 paused with code TARGET_AUTH_REQUIRED",
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toEqual({
      FromEmailAddress: "automation@example.com",
      Destination: { ToAddresses: ["owner@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "Automation needs attention", Charset: "UTF-8" },
          Body: {
            Text: {
              Data: "Run run-1 paused with code TARGET_AUTH_REQUIRED",
              Charset: "UTF-8",
            },
          },
        },
      },
    });
  });

  it("rejects malformed regions before constructing or sending", () => {
    expect(() => new AwsSesV2SendEmailTransport("https://example.com", {
      async send() { return {}; },
    })).toThrow("region is invalid");
  });
});
