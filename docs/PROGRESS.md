# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `0e0304b9fd377d19ccdbec53047009e4dab3f541` (`Align semantic recovery with captured submit authority`).
- Push GitHub Actions CI #348 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google auth, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized run timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install; the AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — make Capture recording readiness authoritative

### Product correctness defect

`Start recording workflow` durably transitioned capture control from `AUTH_SETUP` to `WORKFLOW` and then invoked AgentCore Runtime. Runtime immediately acknowledged that the long-running background capture task had been accepted, but the Playwright collector still had to connect over CDP, expose its event binding, install the init script, instrument existing pages, and attach the future-page/navigation listeners.

The control plane therefore could tell the user recording was active before those listeners existed. A fast first click/input/submit after switching back to Live View could be lost entirely and the resulting trace could compile a workflow missing its first demonstrated action. This is Capture -> Compile product correctness, not crash-recovery micro-hardening.

### Change

- Production capture-control records now carry an explicit durable `collectorReady` bit. AWS initializes it to `false` when the capture control is created and resets it to `false` on the `AUTH_SETUP -> WORKFLOW` transition.
- `AgentCorePlaywrightCaptureEventSource` marks the control `collectorReady=true` only after the Playwright binding, init script, existing-page instrumentation, and future-page hook are installed.
- `CaptureRecordingControlPlaneService.startWorkflow()` treats Runtime acknowledgement as task admission only. For production controls it waits for durable readiness with a fixed 100 ms poll and bounded 10 second startup window before returning recording-active state.
- If startup remains uncertain, the durable workflow phase is preserved for replay-safe Start, while the product-facing view stays on the safe pre-recording presentation until readiness is durable.
- Production Finish is conditionally rejected until `collectorReady=true`.
- Local/mock and legacy controls leave readiness undefined and preserve existing deterministic in-process behavior.

## Security / tenant isolation

- Readiness is one boolean in the existing tenant/user-scoped capture-control record. It contains no URL, DOM content, typed value, Browser Profile/session identity, Live View capability, BYOK material, workload token, provider error, or user secret.
- Tenant/user/automation/capture identity remains derived from authenticated control-plane and trusted Runtime authority.
- Raw typed values remain unresolved runtime-variable placeholders, auth setup remains outside workflow capture, and INPUT screenshots remain suppressed.

## Idempotency / concurrency / retry / timeout

- `markReady` is conditional/idempotent. Concurrent exact readiness updates replay after a strongly consistent read; DynamoDB uncertainty propagates rather than manufacturing success.
- Start remains replay-safe and Runtime keeps duplicate active collector tasks bounded by the same scoped capture identity.
- Finish requires exact durable ready state, preventing Finish from racing listener installation.
- The readiness wait is bounded to 10 seconds and adds no unbounded polling, retry system, queue, lease, or recovery state machine.

## Side-effect verification / user recovery

- Collector readiness proves only that observation instrumentation is attached; it cannot create or weaken effect evidence.
- CLICK/SUBMIT retain structural post-action verification and INPUT retains its privacy-safe verification contract.
- Existing cancel/restart behavior remains the recovery path for failed Runtime/CDP startup.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB table/index, S3 bucket, AgentCore allocation, OpenAI call, Scheduler delivery, or retained Actions artifact is added.
- Added production cost is a bounded handful of strongly consistent reads during Start plus one conditional readiness update per capture.
- Preventing incomplete traces avoids wasted Compile/Fresh Test/browser/model work after a silently lost first demonstration action.

## Regression coverage

- Core capture-control tests prove Finish blocks while production readiness is false, readiness updates idempotently, and local/mock behavior remains compatible.
- AWS DynamoDB tests prove explicit not-ready persistence, strong-read contention classification, and readiness-conditioned Finish.
- AWS Playwright tests prove readiness is written only after binding/init-script/current-page/future-page instrumentation.
- Control-plane tests prove Start does not settle before readiness and the unready product view remains pre-recording.
- Readiness presentation tests use a fixed clock so expiry cannot depend on wall-clock CI date.
- Existing capture submit-normalization fixtures now provide the required readiness callback and ready state, preserving their navigation/action assertions under the production collector contract.

## Validation

- CI #349 on normal head `45ece098ceb28626e333f581f2638d76d5ccc864` passed lock verification and frozen installation, then stopped on syntax accidentally omitted during the batched rewrite; corrective head `46b4cd5795915840fa62a76bbfa4c828abcd540a` restored only that syntax.
- CI #350 passed deterministic lock verification, frozen install, strict `pnpm check`, all three production package builds, and every AWS deployment/security/demo/OIDC contract, then failed one new readiness fixture because that fixture used the real wall clock against an August 21 expiry.
- Head `836e4ad1dbe10707b1fa623a914a95c47dbf2948` fixed only the fixture clock. CI #351 then proved that correction: lock verification, frozen install, `pnpm check`, all production packages/contracts, all 338 core tests, and all 144 web tests passed.
- CI #351 exposed two stale AWS `capture-submit-normalization.test.ts` fixtures that predated the new mandatory production `control.markReady` boundary; both failed before their normalization assertions with `capture collector readiness control is not configured`. Production collector behavior was not implicated.
- This corrective commit updates only those AWS fixtures to provide an idempotent readiness callback and ready control state. No production readiness requirement or validation gate is weakened.
- This head is complete only after GitHub Actions succeeds on the exact published SHA.

Required gates remain deterministic lock verification, frozen install, strict `pnpm check`, all three production package builds, all AWS deployment/security/demo/OIDC contracts, and the complete test suite. Never weaken them to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- VPC Browser mode exists, but route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Popups/new-tab capture and intentionally rapid independent navigation near action transitions still need real-site validation.
- Repository-level `main` protection remains an operational prerequisite before the first production AWS deployment (Issue #29).
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, protect the trusted `main` boundary, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, manually authenticate in Live View, press Start, confirm recording is not declared active until collector readiness is durable, demonstrate one note + native submit action, finish trusted completion, and inspect evidence;
5. compile/inspect and run a >30-second Fresh Test, verifying timeline/reasoning/evidence and SUBMIT-only semantic recovery;
6. publish a near-future recurrence/timezone and verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime with the user device offline;
7. let demo auth expire, verify `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize live defects over speculative recovery hardening.
