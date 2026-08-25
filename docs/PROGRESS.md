# Production Progress

Updated: 2026-08-25

## Current baseline

- `main` now includes `330a89dfa86e5a03af5e187421095dfc7de29d71` (`Add controlled AWS vertical demo target`), squash-promoted from exact PR head `b7399c7c0e68bd8b3847deffe2b6fd96fd515d4b`.
- GitHub Actions CI #331 completed successfully on that exact pre-merge content: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- A separate push-triggered run had not surfaced at the start of this slice, so CI #331 remains the authoritative validation of the promoted content rather than an assumed post-merge pass.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — make protected deployment smoke verify the controlled demo target

### Product gap

The protected deployment smoke verified the finalized web shell, Cognito PKCE redirect, anonymous control-plane rejection, and the IAM-only capture-completion boundary. It did not verify `/demo-target`, even when the same deployment environment enabled that target for the controlled vertical. A deployment could therefore finish green and only later reveal that the first-party target was disabled or misconfigured when the operator began the interactive demo.

### Change

- `scripts/smoke-aws-deployment.sh` now accepts the same non-secret deployment environment JSON used by CloudFormation.
- The smoke derives `parameters.web.DemoTargetEnabled` from that environment rather than trusting a second operator-supplied flag.
- When the target is enabled, live smoke requires unauthenticated `GET /demo-target` to return HTTP 401 with the controlled login action, then requires `POST /demo-target/login` to return the expected same-origin 303 and scoped `HttpOnly; Secure; SameSite=Lax` demo cookie.
- When the target is disabled or omitted, live smoke requires `/demo-target` to remain HTTP 404, proving the public target was not accidentally exposed.
- The protected GitHub OIDC deployment workflow now passes `$RUNNER_TEMP/automation-environment.json` into smoke after deployment, and its summary records that demo-target exposure matched the deployment configuration.
- No deployment manifest schema, CloudFormation resource, AWS permission, Browser/Runtime invocation, model call, retry layer, lease, or recovery subsystem is added.

## Security / tenant isolation

- The smoke reads only deployment outputs and non-secret environment configuration already present on the protected runner.
- It never signs in to Cognito, reads BYOK material, accesses Browser Profiles, invokes AgentCore Runtime, or calls authenticated product APIs.
- The controlled target login probe creates no durable server-side state; it only validates the returned cookie attributes and redirect without storing or replaying the cookie.
- HTTPS/no-embedded-credential URL validation remains in front of every live probe.
- A disabled demo target is now an explicit negative security assertion: the smoke requires 404 rather than merely skipping the route.

## Idempotency / concurrency / retry / timeout

- The additional probes are read-only except the harmless stateless demo-login POST, which only returns a cookie to the smoke process.
- No retry loop is introduced. Existing bounded curl connect/overall timeouts apply to the demo-target probes.
- Re-running smoke is idempotent and creates no durable target/application state.

## Side-effect verification / user recovery

- This change does not modify workflow execution or effect verification.
- It proves the controlled target is in the expected pre-auth state before an operator starts the real capture/test/schedule flow, reducing false failures in the later `TARGET_AUTH_REQUIRED` takeover demonstration.

## Cost / observability

- A protected deployment adds at most two small web-Lambda requests when the target is enabled and one when disabled.
- No S3, DynamoDB, AgentCore, OpenAI, Scheduler, SES, or CloudWatch data-plane operation is added by the smoke itself beyond ordinary Lambda request logging.
- No GitHub Actions artifact is uploaded or retained.

## Regression coverage

- Existing web/Cognito/protected-API smoke behavior remains covered.
- Enabled demo environment succeeds only when `/demo-target` returns 401 with the login marker and the login POST returns the exact safe cookie/redirect contract.
- Enabled environment + live 404 is rejected.
- Disabled environment succeeds only when the route returns 404.
- Unsafe deployment origins and non-S256 Cognito redirects remain rejected.
- The OIDC deployment workflow contract now requires the environment JSON to be forwarded into smoke.

## Validation

This slice is green only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks, including the new demo-target smoke cases;
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
2. require the strengthened live smoke to prove the target is actually enabled and all five System capabilities to report `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, finish trusted completion, and review capture screenshots;
5. compile/inspect and run a >30-second Fresh Test, then inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler → SQS → Step Functions → AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
