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
- `CaptureRecordingControlPlaneService.startWorkflow()` treats the Runtime start acknowledgement as task admission only. For production controls it waits for the durable readiness bit with a fixed 100 ms poll and a bounded 10 second startup window before returning the normal recording-active response.
- If startup remains uncertain, the durable workflow phase is preserved so Start can be retried, while the product-facing state stays on the safe pre-recording presentation until readiness is durable.
- Production Finish is conditionally rejected until `collectorReady=true`, so a direct/stale client cannot finalize a trace during the listener-attachment window.
- Local/mock and legacy controls leave the readiness field undefined and preserve their existing deterministic in-process behavior.

## Security / tenant isolation

- Readiness is only a boolean in the existing tenant/user-scoped capture-control record. It contains no URL, DOM content, typed value, Browser Profile/session identity, Live View capability, BYOK material, workload token, provider error, or user secret.
- Tenant/user/automation/capture-session authority remains derived from the authenticated control plane and trusted Runtime invocation; the browser still cannot choose capture identity.
- Raw typed values remain unresolved runtime-variable placeholders, authentication setup remains outside workflow capture, and INPUT screenshots remain suppressed.

## Idempotency / concurrency / retry / timeout

- `markReady` is conditional/idempotent. Concurrent exact readiness updates replay after a strongly consistent read; DynamoDB transport/throttling uncertainty still propagates instead of manufacturing success.
- Start remains replay-safe: the durable `WORKFLOW` transition can replay and Runtime already suppresses duplicate active collector tasks for the same scoped capture identity.
- Finish requires the exact durable ready state. A user cannot race Finish ahead of listener installation.
- The readiness wait is bounded to 10 seconds and remains below the existing API/Lambda timeout. It adds no unbounded polling, queue, lease, backoff system, or recovery state machine.

## Side-effect verification / user recovery

- Collector readiness only proves observation instrumentation is attached; it does not create or weaken verification evidence.
- CLICK/SUBMIT still require the existing redacted structural post-action verification before compilation. INPUT retains its existing privacy-safe verification contract.
- If Runtime/CDP startup fails, the capture remains restartable through the existing replay-safe Start/cancel flow; no new recovery subsystem is introduced.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB table/index, S3 bucket, AgentCore allocation, OpenAI call, Scheduler delivery, or GitHub Actions artifact is added.
- The only added production cost is a handful of strongly consistent reads during the bounded Start handshake plus one conditional readiness update per capture.
- Preventing an incomplete trace avoids wasted compile/Fresh Test/browser/model work caused by a silently lost first demonstration action.

## Regression coverage

- Core capture-control coverage proves production-style controls reject Finish while not ready, accept idempotent readiness, and permit Finish only afterward while local/mock behavior remains unchanged.
- AWS DynamoDB coverage proves create/start store explicit not-ready state, readiness contention is classified after a strong read, Finish conditionally requires readiness, and non-conditional DynamoDB failures still propagate.
- AWS Playwright collector coverage proves the readiness write occurs after binding/init-script/current-page/future-page instrumentation is attached while existing typed-value redaction and screenshot rules remain intact.
- A dedicated control-plane regression proves Start does not settle before a production-style collector becomes ready and an unready collector stays on the safe pre-recording product presentation.

## Validation

- Normal product head `45ece098ceb28626e333f581f2638d76d5ccc864` triggered GitHub Actions CI #349.
- CI #349 passed deterministic pnpm lock verification and frozen installation, then strict TypeScript stopped on three parser diagnostics in `capture-recording.ts`. Root cause: the batched rewrite accidentally omitted one closing brace from each of the existing sanitized `errorResponse()` object literals. The readiness design and dependency graph were not implicated.
- The single corrective commit restores only those two missing braces and records this root cause. No type check, security boundary, readiness gate, or production behavior is weakened.
- The corrective head is complete only after GitHub Actions succeeds on that exact SHA.

Required gates remain:

1. deterministic pnpm lock verification using the reviewed fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. the full test suite, including the new capture-readiness regressions.

Never weaken these checks to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and the actual VPC network policy.
- VPC Browser mode is present, but route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Popups/new-tab capture and intentionally rapid independent navigation near action transitions still need real-site validation.
- Repository-level `main` protection remains an operational prerequisite before the first production AWS deployment (Issue #29); the application/deployment workflow must not weaken that boundary to compensate.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, run the protected real AWS vertical with the controlled target:

1. protect the trusted `main` promotion boundary, then deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require the strengthened live smoke and all five System capabilities to report `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation targeting `${webOrigin}/demo-target`, manually authenticate in Live View, press Start, confirm the product does not declare recording active until collector readiness is durable, then demonstrate one note + native submit-button action and finish trusted completion;
5. review capture evidence, compile/inspect, and run a >30-second Fresh Test; verify timeline/reasoning/evidence and the SUBMIT-only semantic recovery boundary;
6. publish with near-future recurrence/timezone and a non-secret recurring demo note; verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime while the user device is off;
7. let the demo auth cookie expire, confirm `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save the Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. prioritize defects exposed by that real environment over speculative recovery hardening.
