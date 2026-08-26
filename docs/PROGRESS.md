# Production Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `0ad12eb2e0d2d46d02cd43384fb4225775061051` (`Keep live smoke aligned with signed-out auth`).
- Push GitHub Actions CI #343 completed successfully on that exact SHA: deterministic lock verification, frozen installation, strict checks/builds, all production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — close capture navigation/binding ordering race

### Product correctness defect

The injected capture observer deliberately calls the Playwright exposed binding asynchronously (`void bridge(...)`). A fast form submission or click can therefore navigate the main frame before Node has received the corresponding CLICK/SUBMIT payload and marked that Playwright `Page` as action-owned.

The existing action-driven-navigation suppression only checked `pendingActionPages` at the instant `framenavigated` reached Node. Under the reversed ordering, the same demonstrated action could still become a verified CLICK/SUBMIT plus a second executable NAVIGATION. This is directly relevant to the controlled `/demo-target` POST flow and is a Capture -> Compile -> Fresh Test correctness blocker, not recovery micro-hardening.

### Change

- Main-frame navigation observation now uses a bounded 50 ms action-association grace before it becomes an executable capture event.
- Each Playwright page keeps an in-memory action generation. If a CLICK/SUBMIT binding starts during that grace, the observed navigation is treated as part of that action and suppressed.
- Navigation that arrives while an action is already unsettled remains suppressed immediately.
- Navigation observation is tracked through the existing `pendingEffects` set, so pressing Finish cannot return a trace while an asynchronous navigation classification is still pending.
- Independent main-frame navigation with no associated action remains a first-class `NAVIGATION` capture event after the bounded grace.
- Native CLICK -> SUBMIT coalescing and structural post-action verification are unchanged.

## Security / tenant isolation

- The new state is process-local to one already-authorized AgentCore Browser capture session: Playwright `Page` identity, a small counter, and a generation number only.
- No URL/body/DOM content, cookie, Browser Profile/session identity, BYOK material, workload token, tenant/user identity, or capability is newly persisted or exposed.
- Raw typed values remain unresolved runtime-variable placeholders; INPUT screenshots remain suppressed.
- Tenant/user/automation/capture-session authority remains supplied by the trusted capture worker and durable session/control stores.

## Idempotency / concurrency / retry / timeout

- The change reduces duplicate executable effects by making one browser interaction converge on one captured action even when CDP navigation notification beats the exposed binding across the browser/Node boundary.
- The 50 ms grace is fixed and bounded. It adds no retry loop, backoff policy, lease, queue, or durable concurrency state.
- The action generation avoids relying only on a transient pending flag: an action that begins and settles during the grace still changes the generation and suppresses the earlier derived navigation.
- Finish waits for navigation-classification tasks already observed before the durable finish request, preventing an incomplete trace snapshot.

## Side-effect verification / user recovery

- CLICK/SUBMIT still require the existing redacted structural post-action fingerprint before compilation.
- The grace decides only whether a navigation belongs to an already-demonstrated action; it does not manufacture expected-effect evidence or broaden allowed actions.
- Independent navigation remains capturable and receives its existing URL verification contract at compile time.
- Scheduled execution, semantic fallback, bounded retries, target-auth takeover/resume, human-resolution claims/leases/heartbeat, and crash reconciliation are unchanged.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB/S3 table, AgentCore Runtime invocation, OpenAI request, Scheduler delivery, or retained GitHub Actions artifact is added.
- The only runtime cost is up to 50 ms of capture-worker observation latency for main-frame navigation events; browser action execution itself is not delayed.
- Preventing a duplicate NAVIGATION avoids unnecessary downstream browser navigation and verification cost.

## Regression coverage

- The focused capture regression now delivers main-frame navigation to Node **before** the CLICK/SUBMIT exposed-binding callbacks and still requires exactly one verified SUBMIT with no CLICK/NAVIGATION duplicate.
- A negative-path regression delivers independent navigation with no action binding and requires it to remain a captured `NAVIGATION` after the grace.
- Existing collector/compiler tests continue to cover input redaction/no screenshot, structural verification, bounded action screenshots, phase gating, native submit coalescing, and contiguous trace ordering.

## Validation

- Normal product head `0c05e565a3381d1f2949062174b4433b1fa553bb` triggered CI #344.
- CI #344 stopped exclusively at the deterministic pnpm lock-snapshot gate before install, type-checking, packaging, or tests. No package manifest changed. pnpm 10.15.0 regenerated the full transitive graph from reviewed SHA `2f63d7d3ebae1f017606b4d22dc2e5508003c0cd0988374ce0f856fd14a27234` to authoritative CI-produced SHA `0d0c4be39f0fd860cdc1405b0242b3702293f4a28c5a77d1807cc51fc201902a`.
- The single corrective commit authenticates exactly that CI-produced graph. The existing AWS SDK/DynamoDB peer-alignment assertions remain unchanged; no dependency or check is suppressed.
- The corrective head is green only after GitHub Actions succeeds on that exact SHA.

Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full tests, including the reversed-order navigation/binding and independent-navigation regressions.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture/run screenshots can contain owner-visible page content; retention/deletion policy remains a live-production concern.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider.
- Popups/new-tab capture and intentionally rapid independent navigation within the bounded action-association window still require real-site validation; the controlled first-party target does not depend on those patterns.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical with the controlled target:

1. deploy an exact-head green immutable release with `DemoTargetEnabled=true`, a bounded demo session TTL, and real VPC Browser network inputs;
2. require the corrected live smoke plus all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, capture after manual demo sign-in, demonstrate one note + native submit-button action, finish trusted completion, and confirm capture produces one verified submit with no derived navigation even under real browser/CDP ordering;
5. review capture screenshots, compile/inspect, and run a >30-second Fresh Test; inspect timeline/reasoning/evidence;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
