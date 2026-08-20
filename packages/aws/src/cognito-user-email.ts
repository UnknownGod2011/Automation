import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type ListUsersCommandOutput,
} from "@aws-sdk/client-cognito-identity-provider";
import type { OwnershipScope } from "@automation/core";
import type { SesRecipientResolver, SesResolvedRecipient } from "./ses-notification.js";

const USER_POOL_ENV = "AUTOMATION_COGNITO_USER_POOL_ID";

export interface CognitoListUsersSender {
  send(command: ListUsersCommand): Promise<ListUsersCommandOutput>;
}

export type AwsCognitoUserEmailResolverConfigResult =
  | { configured: true; userPoolId: string }
  | { configured: false; missing: readonly string[] };

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readAwsCognitoUserEmailResolverConfig(
  env: Readonly<Record<string, string | undefined>>,
): AwsCognitoUserEmailResolverConfigResult {
  const userPoolId = nonEmpty(env[USER_POOL_ENV]);
  if (!userPoolId) return { configured: false, missing: [USER_POOL_ENV] };
  if (userPoolId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(userPoolId)) {
    throw new Error(`${USER_POOL_ENV} is invalid`);
  }
  return { configured: true, userPoolId };
}

function safeSubject(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || !/^[A-Za-z0-9._:@+-]+$/.test(trimmed)) {
    throw new Error("Cognito notification user identity is invalid");
  }
  return trimmed;
}

function attribute(
  attributes: readonly { Name?: string | undefined; Value?: string | undefined }[] | undefined,
  name: string,
): string | undefined {
  const matches = (attributes ?? []).filter((item) => item.Name === name);
  if (matches.length !== 1) return undefined;
  const value = matches[0]?.Value?.trim();
  return value ? value : undefined;
}

/**
 * Resolves notification destinations from the deployment-owned Cognito user
 * pool. The scheduled payload never supplies an email address; the stable
 * authenticated `sub` is looked up server-side and only a verified email is
 * eligible for SES delivery.
 *
 * Cognito ListUsers is eventually consistent, so a newly-created user can
 * temporarily resolve to null. Reporting is already best-effort and must not
 * become execution authority.
 */
export class AwsCognitoUserEmailResolver implements SesRecipientResolver {
  private readonly sender: CognitoListUsersSender;

  constructor(
    private readonly userPoolId: string,
    sender?: CognitoListUsersSender,
  ) {
    if (!userPoolId.trim() || userPoolId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(userPoolId)) {
      throw new Error("Cognito user pool id is invalid");
    }
    this.sender = sender ?? new CognitoIdentityProviderClient({});
  }

  async resolve(scope: OwnershipScope, recipientUserId: string): Promise<SesResolvedRecipient | null> {
    const subject = safeSubject(recipientUserId);
    if (subject !== safeSubject(scope.userId)) {
      throw new Error("notification recipient is outside trusted ownership scope");
    }

    const result = await this.sender.send(
      new ListUsersCommand({
        UserPoolId: this.userPoolId,
        Filter: `sub = "${subject}"`,
        Limit: 2,
      }),
    );
    const users = result.Users ?? [];
    if (users.length === 0) return null;
    if (users.length !== 1) throw new Error("Cognito user identity is ambiguous");

    const user = users[0];
    const durableSubject = attribute(user?.Attributes, "sub");
    const email = attribute(user?.Attributes, "email");
    const emailVerified = attribute(user?.Attributes, "email_verified");
    if (durableSubject !== subject) throw new Error("Cognito user identity mismatch");
    if (user?.Enabled === false || !email || emailVerified !== "true") return null;

    return { email };
  }
}

export function createAwsCognitoUserEmailResolver(
  env: Readonly<Record<string, string | undefined>>,
  sender?: CognitoListUsersSender,
):
  | { configured: false; missing: readonly string[] }
  | { configured: true; resolver: AwsCognitoUserEmailResolver } {
  const config = readAwsCognitoUserEmailResolverConfig(env);
  if (!config.configured) return config;
  return {
    configured: true,
    resolver: new AwsCognitoUserEmailResolver(config.userPoolId, sender),
  };
}
