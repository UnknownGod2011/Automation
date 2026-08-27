# Production Progress

Updated: 2026-08-27

## Current baseline

- `main` is `8fec94203607acc318630bfd209adf0fa84ba85d` (`Guide initial publish workflow inputs`) and is independently green on push CI #371.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Fresh Test, initial Publish, and post-publish Scheduled Inputs now use guided per-step values with server-owned mapping to internal `capture_input_N` variables.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — explicit checkbox workflow support

### Product gap

Capture already classified checkbox changes distinctly, but Compile intentionally rejected them because the workflow/runtime had no faithful checkbox primitive. That was safer than pretending a checkbox was text or a generic click, but it left a very common web interaction unsupported.

### Change

- Added provider-neutral `CHECK` workflow node semantics.
- The capture collector now retains only the demonstrated checkbox boolean (`true` / `false`) as a non-secret public literal; it still never captures a field value for checkbox changes.
- Compile converts trusted checkbox capture into a `CHECK` node with one immutable boolean binding and explicit `capture:check-bound-state` verification.
- AWS Playwright uses `locator.check()` / `locator.uncheck()` rather than generic click. Those operations are idempotent, so a retry cannot reverse an already-applied checkbox state.
- The executor re-reads `isChecked()` immediately after mutation, and the verification engine independently re-reads the checkbox before the workflow may advance.
- CHECK remains deterministic-only with owner escalation after bounded retry. The demonstrated state is workflow intent and is never sent to semantic/model recovery.
- Radio, file-upload, password, miscellaneous controls, and multi-select remain fail-closed.

## Security / tenant isolation

- Tenant/user ownership remains unchanged and is still enforced by the existing run/capture/browser boundaries.
- Checkbox capture stores only a boolean state. It does not store the HTML input `value`, page text, cookies, credentials, or Browser Profile data.
- CHECK action and verification evidence are metadata-only; screenshots are suppressed to avoid retaining private form-state context unnecessarily.
- A malformed browser capture payload without an explicit boolean checkbox state is discarded rather than becoming replay authority.
- Password and target authentication remain outside workflow replay and continue to use Browser Profile / human-auth boundaries.

## Idempotency / concurrency / retry / timeout

- CHECK uses Playwright's idempotent check/uncheck primitives rather than toggle-click semantics. Repeating the same desired state is safe and cannot invert it.
- Existing bounded retry policy remains unchanged (`ELEMENT_NOT_FOUND` / `EFFECT_NOT_VERIFIED` plus transient network handling).
- CHECK has no semantic fallback. Selector drift retries deterministically and then escalates to the owner.
- No new run identity, queue, lease, outbox, lock, or persistence authority is introduced.

## Side-effect verification / user recovery

- CHECK is side-effecting and therefore always compiles with explicit verification.
- The deterministic action confirms the reached checkbox state and returns that state only as transient action output.
- The verification engine independently resolves the target and compares `isChecked()` with the action's desired/observed state before execution advances.
- Human recovery remains the existing bounded path; no new recovery subsystem was added.

## Cost / observability

- No new AWS resource, IAM permission, dependency, AgentCore allocation, model request, Scheduler delivery, database read, or retained Actions artifact is added.
- Checkbox execution adds only bounded Playwright state inspection inside the already-running browser session.
- Evidence stays metadata-only for CHECK action/verification, avoiding screenshot storage cost and privacy exposure.

## Regression coverage

- Capture tests prove checkbox changes retain only `true`/`false` and malformed missing state is rejected.
- Compiler tests prove trusted checkbox capture becomes a verified `CHECK` node with an immutable boolean initial variable.
- Compiler rejects a checkbox represented as an unresolved runtime string instead of trusted boolean capture state.
- AWS runtime tests prove check and uncheck behavior, repeat-safe execution, independent selected-state verification, metadata-only evidence, and rejection before browser mutation when bound state is invalid.
- Existing radio/file/password fail-closed coverage remains in place through the unsupported-control path.

## Validation

- This slice is complete only after GitHub Actions succeeds on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch, if one occurs, requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification. Single-select and checkbox are deterministic-only supported controls.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; CHECK semantic recovery is intentionally disabled because the captured boolean is immutable deterministic workflow intent.
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
4. target `${webOrigin}/demo-target`, authenticate in Live View, record the supported SELECT + TYPE + SUBMIT workflow, finish trusted completion, and inspect capture evidence;
5. separately exercise one harmless checkbox workflow on a permitted test page to validate CHECK capture/compile/runtime behavior in real AgentCore Browser;
6. Compile, inspect the semantic plan, and use the guided Fresh Test values;
7. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
8. approve/publish with recurrence, timezone, and guided explicitly non-secret reusable scheduled values;
9. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
10. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete the secure Live View repair, save the Browser Profile, resume once, and reach terminal success.