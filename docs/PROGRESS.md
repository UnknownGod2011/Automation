# Production Progress

Updated: 2026-08-27

## Current baseline

- Incoming `main` is `b9d50241536901ecd9c6b91c3baf3f0002eb0aea` (`Exercise CHECK in controlled AWS demo`) and is independently green on push CI #376.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — deterministic radio-button support

### Product gap

Capture already classified native radio controls and the discrete-control click/change normalization already ensured one radio interaction becomes one INPUT event, but Compile still rejected every RADIO event. Ordinary exclusive-choice forms therefore required reteaching around a common browser control even though Playwright already has an idempotent checked-state primitive.

### Change

- Genuine newly captured RADIO changes now compile into the existing provider-neutral `CHECK` checked-state primitive with immutable `checked=true` intent.
- The semantic target identifies the demonstrated radio option. The browser-supplied HTML radio value is not persisted or required at runtime.
- RADIO compilation accepts only the current privacy-preserving capture shape (`RUNTIME_VARIABLE` descriptor from the collector) and discards that synthetic variable rather than exposing it as a Fresh Test / scheduled input.
- Execution remains deterministic-only: Playwright `check()` selects the exact captured target, `isChecked()` verifies it independently, and selector drift uses bounded retries then human escalation rather than model fallback.
- No new workflow node kind, model action, browser authority, AWS resource, dependency, or recovery state was introduced.

## Security / tenant isolation

- Radio HTML values and user-entered data never enter the compiled graph, checkpoints, evidence metadata, model prompts, or dashboard surfaces through this feature.
- Tenant/user scope, Browser Profile references, capture identities, credentials, and execution authority remain unchanged and server-owned.
- A forged/legacy RADIO event carrying a public literal is rejected rather than being reinterpreted as selected state.
- Password, file, miscellaneous, and multi-select controls remain outside this boundary.

## Idempotency / concurrency / retry / timeout

- Native radio `change` fires for the newly selected option; the captured target therefore represents one fixed demonstrated choice.
- Production execution uses idempotent `check()` rather than toggle-click semantics. Repeating the same node cannot reverse the selected state.
- Existing capture click/change coalescing prevents one radio interaction from becoming `CLICK + CHECK`.
- Existing retry/timeout values are reused; no new retry loop, lease, lock, queue, or persistence authority is introduced.

## Side-effect verification / user recovery

- RADIO compiles to a side-effecting CHECK node with mandatory `capture:check-bound-state` verification.
- The browser action result reports only the boolean selected state and evidence remains metadata-only; verification independently reads `isChecked()` before execution advances.
- Selector drift is deterministic-only and escalates to the owner after bounded retries. No bound radio value or page context is sent to semantic/model recovery.

## Cost / observability

- No new AWS resource, IAM permission, dependency, AgentCore allocation, model request, Scheduler delivery, DynamoDB/S3 write, or retained GitHub Actions artifact is added.
- Reusing CHECK keeps radio execution and verification metadata-only, avoiding screenshot cost/privacy exposure.

## Regression coverage

- Core tests prove a genuine privacy-preserving RADIO event compiles to immutable checked-state intent, removes the unused synthetic capture input, and rejects a forged literal radio descriptor.
- AWS tests prove the compiled target is selected idempotently through `check()` and independently verified through `isChecked()` with screenshot-free evidence.
- Existing collector tests continue to prove radio click/change coalescing and form-control classification.

## Validation

- Incoming `main` is exact-head green on CI #376.
- This slice is complete only after GitHub Actions passes on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- File-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification.
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
4. target `${webOrigin}/demo-target`, authenticate in Live View, record SELECT + TYPE + CHECK + verified SUBMIT, finish trusted completion, and inspect capture evidence;
5. Compile and confirm semantic checked-state actions are explicit and no discrete control produces a duplicate generic CLICK;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and guided explicitly non-secret reusable values;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
