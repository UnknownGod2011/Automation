import type {
  NotificationMessage,
  NotificationPort,
  OwnershipScope,
} from "@automation/core";

export interface SesResolvedRecipient {
  email: string;
}

export interface SesRecipientResolver {
  resolve(scope: OwnershipScope, recipientUserId: string): Promise<SesResolvedRecipient | null>;
}

export interface SesSendEmailRequest {
  from: string;
  to: string;
  subject: string;
  textBody: string;
}

/** Deployment adapter boundary for the official AWS SES SDK client. */
export interface SesSendEmailTransport {
  sendEmail(request: SesSendEmailRequest): Promise<void>;
}

export interface AwsSesNotificationConfiguration {
  fromEmail: string;
  maxBodyCharacters?: number;
}

function validEmail(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length < 3 ||
    trimmed.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  ) {
    throw new Error("notification email address is invalid");
  }
  return trimmed;
}

/**
 * Tenant-scoped SES notification adapter.
 *
 * The application never accepts an arbitrary recipient email in a run command.
 * A deployment-owned resolver maps the authenticated user identity to the
 * destination address, while this adapter rejects cross-user message routing.
 */
export class AwsSesNotificationPort implements NotificationPort {
  private readonly fromEmail: string;
  private readonly maxBodyCharacters: number;

  constructor(
    configuration: AwsSesNotificationConfiguration,
    private readonly transport: SesSendEmailTransport,
    private readonly recipients: SesRecipientResolver,
  ) {
    this.fromEmail = validEmail(configuration.fromEmail);
    this.maxBodyCharacters = configuration.maxBodyCharacters ?? 12_000;
    if (!Number.isInteger(this.maxBodyCharacters) || this.maxBodyCharacters < 256 || this.maxBodyCharacters > 50_000) {
      throw new Error("maxBodyCharacters must be an integer between 256 and 50000");
    }
  }

  async send(scope: OwnershipScope, message: NotificationMessage): Promise<void> {
    if (message.recipientUserId !== scope.userId) {
      throw new Error("notification recipient is outside ownership scope");
    }
    if (message.automationId.length < 1 || message.automationId.length > 256) {
      throw new Error("notification automationId is invalid");
    }
    if (message.subject.length < 1 || message.subject.length > 200) {
      throw new Error("notification subject is invalid");
    }
    if (message.body.length < 1 || message.body.length > this.maxBodyCharacters) {
      throw new Error("notification body is invalid");
    }

    const recipient = await this.recipients.resolve(scope, message.recipientUserId);
    if (!recipient) throw new Error("notification recipient is not configured");

    await this.transport.sendEmail({
      from: this.fromEmail,
      to: validEmail(recipient.email),
      subject: message.subject,
      textBody: message.body,
    });
  }
}
