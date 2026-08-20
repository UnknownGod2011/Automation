import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { SesSendEmailRequest, SesSendEmailTransport } from "./ses-notification.js";

export interface SesV2CommandSender {
  send(command: SendEmailCommand): Promise<unknown>;
}

function validateRegion(value: string): string {
  const region = value.trim();
  if (region.length > 64 || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region)) {
    throw new Error("AWS SES region is invalid");
  }
  return region;
}

/**
 * Official AWS SDK v3 SES v2 transport for the provider-neutral notification
 * port. The caller controls recipient resolution; this transport only sends a
 * single already-sanitized plaintext message.
 */
export class AwsSesV2SendEmailTransport implements SesSendEmailTransport {
  private readonly sender: SesV2CommandSender;

  constructor(region: string, sender?: SesV2CommandSender) {
    const validatedRegion = validateRegion(region);
    if (sender) {
      this.sender = sender;
      return;
    }
    const client = new SESv2Client({ region: validatedRegion });
    this.sender = { send: (command) => client.send(command) };
  }

  async sendEmail(request: SesSendEmailRequest): Promise<void> {
    await this.sender.send(new SendEmailCommand({
      FromEmailAddress: request.from,
      Destination: { ToAddresses: [request.to] },
      Content: {
        Simple: {
          Subject: { Data: request.subject, Charset: "UTF-8" },
          Body: { Text: { Data: request.textBody, Charset: "UTF-8" } },
        },
      },
    }));
  }
}
