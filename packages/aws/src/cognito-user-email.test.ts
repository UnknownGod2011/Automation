import { describe, expect, it, vi } from "vitest";
import {
  AwsCognitoUserEmailResolver,
  createAwsCognitoUserEmailResolver,
  readAwsCognitoUserEmailResolverConfig,
  type CognitoListUsersSender,
} from "./cognito-user-email.js";

const scope = { tenantId: "tenant-a", userId: "11111111-2222-3333-4444-555555555555" } as const;

function senderWithUsers(users: NonNullable<Awaited<ReturnType<CognitoListUsersSender["send"]>>["Users"]>) {
  return {
    send: vi.fn(async () => ({ Users: users, $metadata: {} })),
  } satisfies CognitoListUsersSender;
}

describe("AwsCognitoUserEmailResolver", () => {
  it("loads an explicit Cognito user-pool deployment contract", () => {
    expect(readAwsCognitoUserEmailResolverConfig({})).toEqual({
      configured: false,
      missing: ["AUTOMATION_COGNITO_USER_POOL_ID"],
    });
    expect(
      createAwsCognitoUserEmailResolver({ AUTOMATION_COGNITO_USER_POOL_ID: "us-east-1_example" }),
    ).toMatchObject({ configured: true });
  });

  it("resolves only the verified email belonging to the exact authenticated subject", async () => {
    const sender = senderWithUsers([
      {
        Enabled: true,
        Attributes: [
          { Name: "sub", Value: scope.userId },
          { Name: "email", Value: "owner@example.com" },
          { Name: "email_verified", Value: "true" },
        ],
      },
    ]);
    const resolver = new AwsCognitoUserEmailResolver("us-east-1_example", sender);

    await expect(resolver.resolve(scope, scope.userId)).resolves.toEqual({ email: "owner@example.com" });
    const command = sender.send.mock.calls[0]?.[0];
    expect(command?.input).toEqual({
      UserPoolId: "us-east-1_example",
      Filter: `sub = "${scope.userId}"`,
      Limit: 2,
    });
  });

  it("rejects cross-user routing before Cognito lookup", async () => {
    const sender = senderWithUsers([]);
    const resolver = new AwsCognitoUserEmailResolver("us-east-1_example", sender);

    await expect(resolver.resolve(scope, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).rejects.toThrow(
      "outside trusted ownership scope",
    );
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("does not route disabled, unverified, or missing users", async () => {
    for (const users of [
      [],
      [
        {
          Enabled: false,
          Attributes: [
            { Name: "sub", Value: scope.userId },
            { Name: "email", Value: "owner@example.com" },
            { Name: "email_verified", Value: "true" },
          ],
        },
      ],
      [
        {
          Enabled: true,
          Attributes: [
            { Name: "sub", Value: scope.userId },
            { Name: "email", Value: "owner@example.com" },
            { Name: "email_verified", Value: "false" },
          ],
        },
      ],
    ]) {
      const resolver = new AwsCognitoUserEmailResolver("us-east-1_example", senderWithUsers(users));
      await expect(resolver.resolve(scope, scope.userId)).resolves.toBeNull();
    }
  });

  it("fails closed on ambiguous or mismatched durable identity", async () => {
    const matching = {
      Enabled: true,
      Attributes: [
        { Name: "sub", Value: scope.userId },
        { Name: "email", Value: "owner@example.com" },
        { Name: "email_verified", Value: "true" },
      ],
    };
    await expect(
      new AwsCognitoUserEmailResolver("us-east-1_example", senderWithUsers([matching, matching])).resolve(
        scope,
        scope.userId,
      ),
    ).rejects.toThrow("ambiguous");

    const mismatched = senderWithUsers([
      {
        Enabled: true,
        Attributes: [
          { Name: "sub", Value: "different-sub" },
          { Name: "email", Value: "owner@example.com" },
          { Name: "email_verified", Value: "true" },
        ],
      },
    ]);
    await expect(
      new AwsCognitoUserEmailResolver("us-east-1_example", mismatched).resolve(scope, scope.userId),
    ).rejects.toThrow("identity mismatch");
  });
});
