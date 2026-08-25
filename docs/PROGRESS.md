# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `498d343ba568854d74269cf7b895c18039ccf272` (`Normalize native submit capture`).
- Push GitHub Actions CI #339 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — keep action-driven navigation inside the captured action

### Product defect

The live collector records main-frame navigation events independently from CLICK/SUBMIT events. A normal action that navigates the page can therefore produce a verified browser action followed by a second executable NAVIGATION event. The controlled `/demo-target` exposes this directly: submitting the note POSTs to `/demo-target/action`; replaying a later captured NAVIGATION would then attempt a GET against that POST-only route after the submit had already succeeded.

This is a Capture -> Compile -> Fresh Test correctness blocker, not a recovery edge case.

### Change

- `AgentCorePlaywrightCaptureEventSource` now tracks pages with an unsettled captured CLICK/SUBMIT during the existing bounded post-action verification interval.
- Main-frame navigation observed on that same page while the action is unsettled is treated as part of the action's resulting state and is not emitted as a second executable NAVIGATION event.
- Independent navigation with no unsettled action remains capturable exactly as before.
- Native click -> submit normalization remains intact: the initiating click is suppressed and the submit remains the single authoritative browser action.
- The action's structural post-state fingerprint remains the verification authority; no compiler or verifier rule is weakened.

## Security / tenant isolation

- The normalization is process-local inside one already-authorized capture Browser session. It adds no API route, durable authority, credential, profile selection, cross-tenant lookup, or browser capability.
- Tenant/user/automation/capture-session identity remains supplied by the trusted capture worker and durable stores.
- Raw typed values remain excluded from capture events and INPUT screenshots remain suppressed.
- No page content is persisted by the pending-page marker; it stores only in-memory Playwright Page object identity plus a bounded counter.

## Idempotency / concurrency / retry / timeout

- One demonstrated side effect now maps to one executable action rather than action + derived navigation, reducing duplicate-side-effect and invalid-replay risk.
- The existing effect-settle timeout is reused; no retry loop or new unbounded timer is introduced.
- The marker is reference-counted because CLICK and SUBMIT can overlap briefly during native form submission; it is cleared when each tracked action settles or fails.
- Finish still waits for tracked post-action tasks, so the verified action cannot be lost by immediately finishing capture.

## Side-effect verification / user recovery

- CLICK/SUBMIT still require the existing redacted structural post-action fingerprint before compilation.
- A derived navigation is suppressed only while an action is already responsible for the page transition; independent navigation remains a first-class captured event.
- Capture screenshots remain supplementary evidence and cannot authorize success.
- Scheduled execution, semantic fallback, bounded retries, target-auth takeover/resume, and crash-reconciliation behavior are unchanged.

## Cost / observability

- No AWS resource, IAM permission, dependency, S3/DynamoDB table, AgentCore Runtime invocation, OpenAI request, Scheduler delivery, or retained GitHub Actions artifact is added.
- Removing redundant navigation avoids one unnecessary runtime navigation + verification on workflows whose action already transitions the page.

## Regression coverage

- The focused native-submit regression now emits CLICK + SUBMIT, then delivers a main-frame navigation while the action effect is unsettled.
- The returned trace must contain exactly one verified SUBMIT event and no CLICK or NAVIGATION duplicate.
- Existing collector/compiler tests continue to cover independent navigation, structural verification, screenshot behavior, INPUT redaction, phase gating, and contiguous trace ordering.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full tests, including the action-driven-navigation normalization regression.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- The controlled target proves platform integration, not arbitrary-site compatibility or target security.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Popups/new-tab actions and intentionally rapid manual navigation immediately after an action should be validated on real sites before broadening capture normalization.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require protected live smoke plus all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, demonstrate one note + native submit-button action, finish trusted completion, and confirm the trace contains one verified submit with no derived navigation duplicate;
5. review capture screenshots, compile/inspect, and run a >30-second Fresh Test; inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
