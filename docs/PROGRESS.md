# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `6e1c7ece958b8354db06d0c34ad2bfdb800bf032` (`Close capture navigation binding race`).
- Push GitHub Actions CI #346 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized run timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install; the AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — preserve captured SUBMIT authority during semantic recovery

### Product correctness defect

A captured `SUBMIT` event compiles to a `CLICK`-kind workflow node whose immutable `allowedSideEffects` is exactly `["SUBMIT"]`. Deterministic execution intentionally clicks the demonstrated submit target once, which activates the native form submission. If that deterministic target drifts, however, semantic recovery previously derived its allowed action from `node.kind`, authorizing generic `CLICK` rather than the immutable `SUBMIT` authority. The AWS Playwright semantic executor also had no explicit `SUBMIT` primitive.

That mismatch could either make semantic recovery unusable or broaden the model to a generic click when the graph authorizes only form submission. This is Capture -> Compile -> Fresh Test/Scheduled execution correctness, not recovery micro-hardening.

### Change

- Core semantic recovery now recognizes the narrow compiler shape `kind=CLICK` + exactly `allowedSideEffects=["SUBMIT"]` and exposes only `SUBMIT` to the reasoning provider.
- Generic CLICK nodes continue to expose CLICK; REASON nodes continue to expose their declared allowed side effects.
- The AWS Playwright runtime now supports one explicit semantic `SUBMIT` action. It resolves a target through the existing bounded semantic locator policy, checks visibility, and performs exactly one Playwright click/activation.
- The semantic executor defensively rejects a non-REASON decision whose action is outside the immutable node side-effect set, so a generic CLICK cannot execute against a submit-only node even if a caller bypassed the normal core decision validation.
- Post-effect verification is unchanged and remains mandatory before the workflow advances.

## Security / tenant isolation

- No tenant/user identifiers, form values, selectors, DOM/page contents, Browser Profile/session identities, workload tokens, BYOK secrets, provider errors, or model rationale are newly persisted or surfaced.
- Reasoning still receives only the existing trusted scope plus bounded workflow/node context. The semantic reasoning objective remains the immutable workflow goal plus current step, not tenant/user identity.
- The SUBMIT primitive does not accept arbitrary JavaScript or form payloads. It uses only the existing constrained semantic locator inputs and one browser activation.
- Tenant isolation remains enforced by the existing run/worker/browser composition and durable repositories.

## Idempotency / concurrency / retry / timeout

- The new primitive dispatches the selected submit target exactly once. It never falls through to a second locator after the side effect.
- Existing deterministic-first execution, retry budgets, repeated-state detection, automation leases, scheduled occurrence idempotency, and human-resume claims/leases are unchanged.
- Semantic SUBMIT uses the existing node timeout and locator-visibility boundary; no new retry loop, timeout layer, queue, lease, or recovery state is added.

## Side-effect verification / user recovery

- A semantic SUBMIT cannot authorize itself. The existing immutable `verification` contract is still evaluated after the browser action and must pass before the node completes.
- A model decision returning CLICK for a submit-only captured node is `POLICY_BLOCKED` before browser semantic dispatch.
- Existing bounded escalation/human attention remains the fallback if semantic recovery cannot produce a permitted verified action.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB/S3 schema, AgentCore allocation, OpenAI call count, Scheduler delivery, or retained GitHub Actions artifact is added.
- The change only makes an already-existing semantic-recovery attempt executable under the correct action authority. It does not add another reasoning attempt.
- Existing bounded reasoning summaries can record the selected `SUBMIT` action without storing model chain-of-thought or form data.

## Regression coverage

- A core integration fixture compiles a real `CaptureTrace` SUBMIT event, forces deterministic `ELEMENT_NOT_FOUND`, and proves semantic recovery receives only `["SUBMIT"]`, dispatches SUBMIT, passes the existing verifier, and reaches `SUCCEEDED`.
- The same fixture returns a forged generic CLICK decision and proves it is policy-blocked before semantic browser execution.
- An AWS Playwright regression proves semantic SUBMIT resolves one constrained target and activates it exactly once.
- A defense-in-depth AWS regression proves generic CLICK against the submit-only node is rejected with zero target clicks and zero evidence writes.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification using the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. the full test suite, including the new captured-SUBMIT semantic-recovery regressions.

Never weaken these checks to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and the actual VPC network policy.
- VPC Browser mode is present, but route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Popups/new-tab capture and intentionally rapid independent navigation near action transitions still need real-site validation.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, run the protected real AWS vertical with the controlled target:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require the strengthened live smoke and all five System capabilities to report `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, demonstrate one note + native submit-button action, finish trusted completion, and review capture evidence;
5. compile/inspect and run a >30-second Fresh Test; if the deterministic submit locator is intentionally drifted in a controlled fixture, verify semantic recovery remains SUBMIT-only and effect verification still gates success;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
