# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `a10af826a2dd0aa2e816957bc136b694bea6e2fb` (`Verify controlled demo target in live smoke`).
- Push GitHub Actions CI #334 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — prove the controlled demo workflow itself in protected live smoke

### Product gap

The protected deployment smoke proved that the controlled demo target was exposed only when configured, that its pre-auth page returned 401, and that the login route issued a correctly scoped cookie. It did not prove that the deployed target actually accepted that cookie, rendered the authenticated workflow form, or completed the harmless workflow action. A deployment could therefore pass smoke while the first-party target required for the real vertical was still unusable after login.

### Change

- `scripts/smoke-aws-deployment.sh` now carries the exact issued demo cookie into a second `GET /demo-target` and requires the authenticated workflow page to return 200 with both the `demo-note` and `demo-submit` controls.
- The smoke then performs the harmless controlled `POST /demo-target/action` with a fixed non-secret note and requires HTTP 200 plus the stable `demo-complete` marker.
- The submitted smoke note must not be reflected in the response. This live assertion protects the intended privacy property used by capture/evidence review.
- The cookie value is kept process-local and is never printed into the deployment summary, logs, manifests, or artifacts.
- Disabled demo deployments still require 404 and perform no login/action probes.
- No CloudFormation resource, AWS permission, Browser/Runtime invocation, model call, retry layer, lease, storage schema, or recovery subsystem is added.

## Security / tenant isolation

- The smoke still reads only non-secret deployment outputs and deployment environment configuration.
- It does not sign in to Cognito, access user automations, read BYOK material, touch Browser Profiles, invoke AgentCore Runtime, or call authenticated control-plane operations.
- The controlled demo cookie exists only inside the smoke process for the duration of the command and is removed with the temporary directory/process state.
- The action input is a fixed non-secret literal. The smoke explicitly fails if the target reflects that literal into the response.
- HTTPS/no-embedded-credential validation remains in front of all deployment URLs.
- A disabled demo target remains a negative security assertion: 404 is required and no session/action probe is attempted.

## Idempotency / concurrency / retry / timeout

- The demo target has no durable server-side action state, so the added login/session/action probes remain idempotent.
- No retry loop is introduced; existing bounded curl connect and overall timeouts apply to every request.
- Re-running protected smoke cannot create automations, schedules, runs, credentials, Browser Profiles, or target-side durable records.

## Side-effect verification / user recovery

- This slice does not alter workflow effect verification. The controlled demo action remains only a deployment prerequisite check.
- Structural capture verification remains authoritative for compiled browser execution; a passing HTTP smoke cannot make an unverifiable captured action compile or succeed.
- Proving the post-login workflow form and completion marker live removes a false-failure source before the later `TARGET_AUTH_REQUIRED` expiry/repair/resume demonstration.

## Cost / observability

- Enabled deployments add two small web-Lambda requests to protected smoke: authenticated workflow GET plus one harmless action POST.
- Disabled deployments retain the single 404 probe.
- No S3, DynamoDB, AgentCore, OpenAI, Scheduler, Step Functions, SES, or application CloudWatch data-plane work is introduced beyond ordinary web-Lambda request logging.
- No GitHub Actions artifact is uploaded or retained.

## Regression coverage

- Existing web shell, Cognito PKCE, anonymous control-plane rejection, IAM-only capture-completion rejection, and enabled/disabled demo exposure checks remain covered.
- An issued demo cookie that the target refuses is rejected.
- A broken controlled action is rejected.
- A controlled action response that reflects the submitted note is rejected.
- The happy path requires authenticated workflow controls and the stable completion marker.
- Disabled demo configuration continues to require 404.

## Validation

This slice is green only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks, including authenticated demo workflow/action smoke cases;
6. full tests.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- The controlled target proves platform integration, not arbitrary-site compatibility or target security.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB ↔ EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require protected live smoke to prove pre-auth, issued-session acceptance, workflow rendering, harmless action completion, non-reflection, and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, finish trusted completion, and review capture screenshots;
5. compile/inspect and run a >30-second Fresh Test, then inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler → SQS → Step Functions → AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
