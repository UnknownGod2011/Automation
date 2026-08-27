# Production Progress

Updated: 2026-08-27

## Current baseline

- Incoming `main` is `f4b9d33a306ee0d0cca73ed678dda2c7b1630bee` (`Support deterministic captured radio selection`) and is independently green on push CI #378.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — exercise RADIO in the controlled first-party AWS vertical

### Product gap

Deterministic native radio-button support is now production-ready, but the recommended `/demo-target` still exercised only SELECT + TYPE + CHECK + SUBMIT. That left the new radio path outside the one controlled workflow intended to prove the complete Capture -> Compile -> Fresh Test -> scheduled execution vertical.

### Change

- Added a native two-option **Handling mode** radio group to `/demo-target`.
- Every fresh authenticated form starts with **Standard handling** selected; successful completion requires **Focused handling**, so the radio action must actually execute rather than pass from the default page state.
- Capture of the Focused option uses the existing privacy-preserving RADIO shape. Compile discards the radio HTML value and binds immutable checked-state intent to the demonstrated semantic target.
- The controlled target accepts only the single required Focused mode at submission and never reflects or persists it.
- The protected AWS live smoke now requires the radio fixture, submits `mode=focused`, and rejects a deployment whose radio fixture disappears.
- `docs/AWS_VERTICAL_DEMO.md` now uses one first-party workflow to prove SELECT + TYPE + RADIO + CHECK + verified SUBMIT.

## Security / tenant isolation

- The radio group is part of the staging/demo-only first-party target and remains disabled by default with `/demo-target`.
- Radio HTML values are not capture authority, workflow runtime inputs, durable application state, or model context. The semantic target identifies the demonstrated option and the compiled checked-state intent contains only `checked=true`.
- Submitted priority/mode/note/confirmation values are never reflected by the completion response.
- Tenant/user ownership, Browser Profile references, capture/session identities, BYOK secrets, workload tokens, and execution authority remain server-owned and unchanged.
- Password, file, miscellaneous, and multi-select controls remain outside this boundary.

## Idempotency / concurrency / retry / timeout

- Native radio change is already normalized to one executable event; the initiating click is coalesced rather than becoming `CLICK + CHECK`.
- Production radio execution reuses idempotent `check()` semantics and independent `isChecked()` verification. Repeating the node cannot reverse the selected option.
- No new queue, lock, lease, retry policy, timeout, persistence authority, Browser allocation, or recovery state is introduced.

## Side-effect verification / user recovery

- The radio selection remains deterministic-only and must satisfy `capture:check-bound-state` before execution advances.
- The controlled target additionally requires Focused handling at submit time, so skipping the radio step cannot accidentally produce a successful end-to-end target response.
- Existing SELECT, TYPE, CHECK, and SUBMIT verification remains unchanged.
- Existing target-auth recovery remains unchanged: after the short-lived demo cookie expires, navigation returns 401 and enters the current `TARGET_AUTH_REQUIRED` takeover/profile-save/resume path.

## Cost / observability

- No new AWS resource, IAM permission, dependency, AgentCore/model invocation, Scheduler delivery, DynamoDB/S3 write, or retained GitHub Actions artifact is added.
- The strengthened protected smoke adds no extra HTTP request; it validates and submits the radio value through the existing controlled form request.
- Radio/check evidence remains metadata-only in execution, avoiding extra screenshot cost/privacy exposure.

## Regression coverage

- Web target tests prove the authenticated form exposes Standard and Focused radio options, only Focused is accepted for completion, and submitted mode values are never reflected.
- The protected live smoke requires `demo-mode-focused`, posts `mode=focused`, and rejects a missing-radio fixture.
- Existing core/AWS tests continue to prove RADIO capture normalization, compile-time value redaction, deterministic checked-state execution, and independent verification.

## Validation

- Incoming `main` is independently green on push CI #378.
- This slice is complete only after GitHub Actions passes on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- File upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification.
- SELECT, CHECK, and radio checked-state execution remain deterministic-only; model fallback is intentionally not used for private runtime values or immutable checked-state intent.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, configure required GitHub `main` protection, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, record **SELECT + RADIO + TYPE + CHECK + verified SUBMIT**, finish trusted completion, and inspect capture evidence;
5. Compile and confirm the semantic plan contains one SELECT, one TYPE, two checked-state actions (radio + checkbox), and one verified SUBMIT, with no duplicate generic CLICK for discrete controls;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and guided explicitly non-secret reusable SELECT/TEXT values;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
