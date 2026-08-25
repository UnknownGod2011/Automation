# Production Progress

Updated: 2026-08-25

## Current baseline

- Incoming `main`: `f5ac4f55a36a54287b045b4eae2a7c282dac5ec3` (`Add authenticated capture evidence review`).
- GitHub Actions CI #330 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — add a controlled first-party target for the real AWS vertical

### Product gap

The next milestone is the protected real AWS vertical demonstration, but the runbook still depended on an unspecified permitted third-party test site. That makes capture behavior, consequential action verification, Browser Profile authentication persistence, scheduled execution, and deliberate auth expiry dependent on external product changes and security policy. The local lifecycle is already comprehensively proven; another in-memory lifecycle test would not close this live-integration gap.

### Change

- Add an opt-in controlled target at `/demo-target` inside the deployed Next.js web application.
- The target is disabled by default. `DemoTargetEnabled=true` is required in the web stack for staging/demo use.
- The target has a simple manual **Sign in to demo target** AUTH_SETUP step that sets only a short-lived scoped demo cookie.
- The reusable workflow page contains one note field and one submit action. The submitted note is never reflected into HTML or screenshots.
- The post-action page has a stable structural marker suitable for the existing capture structural-state verification contract. Every new navigation starts from the same workflow form, so repeated Fresh Test/scheduled runs must actually perform the action before the captured post-state can be observed.
- Once the demo auth cookie expires, `GET /demo-target` returns HTTP 401. The existing Playwright runtime already classifies a navigation response with status 401 as `TARGET_AUTH_REQUIRED`, so the real secure takeover/Profile-save/resume path can be exercised deterministically.
- Add bounded web-stack parameters `DemoTargetEnabled` (default `false`) and `DemoTargetSessionTtlSeconds` (60-3600 seconds, default 900). No new AWS resource or data-plane IAM permission is introduced.
- Update the controlled AWS demo runbook to prefer this first-party target for the initial vertical while keeping arbitrary-site network-policy validation as a separate production requirement.

## Security / tenant isolation

- The demo target is intentionally harmless and protects no user data. Its login button simulates target authentication solely to exercise Browser Profile persistence and expiry behavior.
- It is public only when explicitly enabled in deployment configuration and is disabled by default in CloudFormation.
- The session cookie is scoped to `/demo-target`, `HttpOnly`, `Secure`, `SameSite=Lax`, and bounded to at most one hour.
- The target adds no DynamoDB/S3/AgentCore/Identity/Scheduler/SES permission to the public web Lambda; existing hosting IAM remains logs-only.
- User-entered demo notes are bounded to 4,096 characters and never reflected into the response. Capture INPUT screenshots remain suppressed by the existing collector.
- Existing Cognito tenant ownership, AgentCore Browser/Profile isolation, BYOK secret boundaries, and authenticated control-plane APIs are unchanged.

## Idempotency / concurrency / retry / timeout

- Demo target state is request-local/browser-local only; there is no server-side mutable target record to race or reconcile.
- Each navigation returns the same pre-action structure. Each submit returns the same post-action structure, making the demo repeatable across capture, Fresh Test, and scheduled runs.
- No retry loop or background task is introduced.
- Session TTL is bounded and configuration fails closed when enabled with an invalid TTL.

## Side-effect verification / user recovery

- The demo action is harmless, but the page intentionally changes structure only after the form submit. The existing capture collector/verifier remains authoritative; this target does not add a verification bypass.
- HTTP 401 on expired demo auth flows through the existing `TARGET_AUTH_REQUIRED` classification and secure repair Live View. No new human-recovery state machine is added.
- CAPTCHA/MFA bypass remains prohibited; the demo target itself contains neither.

## Cost / observability

- When disabled, the target adds no runtime requests or cloud cost.
- When enabled for a demo, requests use the already-deployed bounded Next.js Lambda and no additional AWS service.
- No additional S3/DynamoDB/AgentCore/OpenAI/Scheduler/SES/CloudWatch operation is generated by the target itself.

## Regression coverage

- Demo target is disabled by default.
- Session TTL accepts only 60-3600 seconds and invalid enabled configuration returns a fixed 503.
- Unauthenticated navigation returns HTTP 401 with the manual sign-in form.
- Login sets a scoped HttpOnly/Secure/SameSite demo cookie and redirects only to `/demo-target`.
- Authenticated navigation exposes stable `demo-note` and `demo-submit` targets.
- Submitted notes are not reflected into the post-action page; completion exposes only the stable structural `demo-complete` marker.
- Missing/expired auth cookie returns HTTP 401, matching the production Browser runtime's target-auth classification path.
- Web hosting contract asserts the demo target remains default-off and does not broaden web Lambda IAM.

## Validation

This slice is green only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full tests including the controlled demo-target regressions.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- The controlled target proves platform integration, not arbitrary-site compatibility or target security. Broader production use still requires permitted target sites and site-specific policy compliance.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB ↔ EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target rather than adding more recovery internals:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require live public/auth smoke and all five System capabilities to report `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target` with objective `Enter the provided non-secret demo note and complete the demo task.`;
5. start Live View, click the demo target's manual sign-in before recording, record typing/submitting a non-secret note, finish trusted completion, and review capture screenshots;
6. compile/inspect and run a >30-second Fresh Test, then inspect timeline/reasoning/evidence;
7. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler → SQS → Step Functions → AgentCore Runtime execution while the user device is off;
8. wait for the demo auth cookie to expire, confirm the next navigation reaches `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
9. prioritize defects exposed by that real environment over speculative recovery hardening.
