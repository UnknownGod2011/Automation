# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `c0369a91ceab07ffe52b38d2aa6ce7b505598631` (`Verify controlled demo workflow in live smoke`).
- Push GitHub Actions CI #336 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — normalize native form submission during live capture

### Product defect

The production Playwright capture bridge observed both DOM `click` and DOM `submit` events independently. Clicking a native submit button therefore produced a captured CLICK followed by a captured SUBMIT. The compiler correctly treats both events as executable, verified workflow actions, so one demonstrated form submission could become two consequential replay steps. The controlled first-party `/demo-target` uses exactly this normal note + submit-button interaction, making the defect a blocker for the real capture -> compile -> Fresh Test vertical rather than a recovery edge case.

### Change

- `AgentCorePlaywrightCaptureEventSource` now keeps an unsettled CLICK pending during the existing bounded post-action settle interval.
- If a native SUBMIT arrives from the same page while that CLICK is pending, the initiating CLICK is suppressed and the SUBMIT becomes the single authoritative captured action.
- Plain clicks that do not produce a form submission remain unchanged.
- The injected browser observer now prefers the DOM `SubmitEvent.submitter` as the semantic target, so normal button-driven submissions retain the actionable button/test-id/role rather than degrading to the enclosing form.
- Semantic target extraction now resolves nested click content to the nearest bounded interactive element, reducing brittle captures such as a `<span>` inside a button.
- Because a suppressed pending click can consume an internal observation ordinal, returned capture events are re-numbered contiguously before trace validation. Event IDs remain opaque and immutable for that collection; only the public sequence is normalized.
- No compiler verification rule is weakened: SUBMIT still requires a trustworthy captured post-action structural-state contract before the workflow can compile.

## Security / tenant isolation

- The change runs only inside the already-authorized AgentCore Browser capture session and adds no new browser capability, API route, credential, storage authority, or cross-tenant lookup.
- Tenant/user/automation/capture-session identity remains supplied by the trusted capture worker and durable session/control stores.
- Raw typed values remain excluded from capture events; INPUT events still emit runtime-variable placeholders and never take post-input screenshots.
- The coalescing key is the already-bounded HTTP(S) page URL observed inside one capture process. It is not durable authorization state and never crosses tenants or sessions.
- The submit target still passes through the existing bounded semantic-target normalization; no arbitrary script or selector execution is introduced.

## Idempotency / concurrency / retry / timeout

- One native browser interaction now maps to one executable submit event instead of two, reducing duplicate-side-effect risk at the source.
- The existing effect-settle interval is reused; no new retry loop or unbounded timer is introduced.
- Multiple pending clicks are process-local capture observations only. A SUBMIT suppresses the latest unsettled click on the same page, matching normal browser event ordering where submit follows its initiating click.
- Finish still waits for tracked post-action observation tasks before returning the trace, so the normalization cannot drop an in-flight verified submit merely because the user pressed Finish quickly.
- Existing durable capture-session/control idempotency and completion semantics are unchanged.

## Side-effect verification / user recovery

- Structural post-action verification remains mandatory and independent of the coalescing decision. If the collector cannot establish trustworthy post-submit state, the compiler still rejects that event.
- Capture screenshots remain supplementary evidence only and cannot authorize compilation or execution.
- This slice does not change scheduled execution, semantic recovery, human takeover, lease/heartbeat behavior, or crash reconciliation.
- A remaining live risk is keyboard/implicit submission where `SubmitEvent.submitter` can be absent; the collector falls back to the form target. The first controlled demo explicitly uses the visible submit button, and broader form-submission recovery should be driven by real-site evidence rather than speculative recovery expansion.

## Cost / observability

- No AWS resource, IAM permission, dependency, S3/DynamoDB table, AgentCore Runtime invocation, OpenAI request, Scheduler delivery, or retained GitHub Actions artifact is added.
- Native submit capture now avoids one redundant executable node and its downstream browser action/verification cost.
- Existing capture action screenshot behavior is unchanged: CLICK/SUBMIT may retain one bounded post-action PNG; INPUT never does.

## Regression coverage

- New AWS capture regression emits a CLICK immediately followed by SUBMIT for the same page and requires exactly one returned event: verified `SUBMIT`, sequence `1`, with the actionable button semantic target retained.
- Existing capture tests continue to cover plain CLICK structural verification, bounded screenshot persistence, fail-soft screenshot storage, INPUT value redaction/no screenshot, phase gating, and finish-before-connect behavior.
- Existing compiler tests continue to require expected effects for side-effecting captured actions and contiguous trace ordering.

## Validation

This slice is green only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full tests, including the new native-submit normalization regression.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- The controlled target proves platform integration, not arbitrary-site compatibility or target security.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Keyboard/implicit form submissions can lack a submitter target and should be validated on real sites before broadening the form-action runtime contract.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require protected live smoke plus all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, demonstrate one note + native submit-button action, finish trusted completion, and confirm the trace compiles to one submit action rather than CLICK + SUBMIT duplication;
5. review capture screenshots, compile/inspect, and run a >30-second Fresh Test; inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
