# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `c5be0ec48f2b204686e06ef3520a379e122b5db8` (`Keep action-driven navigation inside captured actions`).
- Push GitHub Actions CI #341 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — keep the live deployment smoke aligned with the real signed-out product shell

### Product/deployment defect

The deployed signed-out dashboard now presents `Sign in with Google or email`, but `scripts/smoke-aws-deployment.sh` still required the old literal `Sign in with Cognito`. The no-cloud smoke fixture also rendered that obsolete text, so CI could remain green while the first real protected deployment failed its live smoke despite a healthy authentication route.

This is a real deployment blocker for the vertical demo, not recovery hardening.

### Change

- The live smoke no longer couples deployment health to user-facing authentication copy.
- It now requires the stable same-origin sign-in route `href="/api/auth/sign-in?returnTo=/"`, then independently verifies that route redirects to the deployed Cognito domain using authorization-code flow, PKCE S256, the exact callback URL, required scopes, client ID, and state.
- The fake web fixture now matches the current product copy (`Sign in with Google or email`) and includes the real sign-in href.
- A negative regression removes the sign-in href while leaving the product shell intact and requires the smoke to fail with a sanitized missing-authentication-action error.

## Security / tenant isolation

- The smoke remains anonymous/read-only except for the harmless first-party demo target action already covered by the deployment contract.
- No bearer token, Cognito session, BYOK secret, Browser Profile/session identity, workload token, tenant/user identifier, or Live View capability is introduced.
- Checking the stable route rather than display copy strengthens the authentication-boundary assertion without depending on provider branding.

## Idempotency / concurrency / retry / timeout

- No production mutation or execution path changes.
- Existing bounded curl connect/overall timeouts remain unchanged.
- The smoke still performs one sign-in redirect check and does not complete OAuth or create cloud automation state.

## Side-effect verification / user recovery

- Browser execution, workflow verification, target-auth takeover/resume, retries, leases, and reconciliation are unchanged.
- The controlled demo action remains the only smoke mutation and continues to require its stable completion marker while rejecting reflected note content.

## Cost / observability

- No AWS resource, IAM permission, dependency, AgentCore Browser/Runtime allocation, OpenAI request, Scheduler delivery, DynamoDB/S3 write, or retained GitHub Actions artifact is added.
- The new negative contract is no-cloud CI only.

## Regression coverage

- The normal fake deployment now uses the current signed-out product copy and the stable sign-in href.
- A shell with the product headline but without the sign-in href must fail before auth redirect validation.
- Existing coverage still verifies PKCE S256, unsafe-origin rejection, anonymous protection of control-plane/capture-completion APIs, controlled demo auth/session/action behavior, note non-reflection, and disabled demo-target behavior.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full tests, including the strengthened deployment-smoke regression.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Popups/new-tab capture and rapid intentional navigation immediately after an action still need real-site validation.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require the corrected live smoke plus all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, demonstrate one note + native submit-button action, finish trusted completion, and review capture evidence;
5. compile/inspect and run a >30-second Fresh Test; inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
