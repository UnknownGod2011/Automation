# Automation Platform Progress

Updated: 2026-08-26

## Current baseline

- Incoming `main` is `45749bdaaa86d2adee8bb245344ca8762c0afdd7` (`Fail closed on unsupported captured form controls`).
- Push GitHub Actions CI #355 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — explicit single-select workflow support

### Product gap

The production collector already classifies form controls and the compiler correctly refused SELECT/CHECKBOX/RADIO/FILE/PASSWORD instead of miscompiling them as TYPE. That fail-closed behavior was safe, but ordinary single-select dropdowns are common enough that Capture -> Compile -> Fresh Test remained unnecessarily incomplete for normal web forms.

### Change

- `SELECT` is now an explicit provider-neutral workflow-node kind rather than pretending dropdown choice is text typing.
- A captured single-select keeps using the existing unresolved `capture_input_N` runtime-input boundary, so the demonstrated option is not persisted in the capture trace.
- The compiler emits a SELECT node with `allowedSideEffects=["SELECT"]`, deterministic target strategies, bounded retry policy, and a dedicated `capture:select-bound-value` verification contract.
- SELECT is deliberately deterministic-only in this slice. Selector drift retries within the existing bounded policy and then escalates to the owner rather than sending the bound option value to a model.
- The AWS Playwright executor resolves the captured target and performs one `selectOption` operation using the bound option label. It returns the browser-selected underlying value transiently to verification.
- Verification re-resolves the immutable target and requires its actual selected value to equal the value produced by that one selection operation before the workflow can advance.
- SELECT execution and verification suppress screenshots, matching TYPE privacy behavior for per-run input material.
- Checkbox, radio, file, password, and other controls remain fail-closed until they receive explicit provider-neutral semantics and verification.

## Security / tenant isolation

- No raw selected option is added to the capture trace, workflow graph, browser profile metadata, logs, metrics, email, or user-visible diagnostics. The selection continues to arrive through the existing tenant/user-scoped runtime-input path.
- SELECT evidence persists only the same bounded browser metadata already used by deterministic execution; screenshots are suppressed after selection and during its verification.
- Tenant/user/automation/run authority is unchanged and remains server-derived. No caller gains a new target-selection or workflow-control identity.
- Password controls remain explicitly unsupported for workflow replay; target authentication stays in the persisted Browser Profile and human auth/takeover path.

## Idempotency / concurrency / retry / timeout

- The SELECT executor resolves one locator and performs one selection operation. It never falls through to a second selector after mutation.
- Existing node retry budgets remain authoritative. SELECT selector/verification failures are bounded and then escalate to human attention; no new retry loop, queue, lease, outbox, or recovery state machine is introduced.
- The dedicated verification contract checks the browser state after the action rather than treating dispatch success as effect success.
- No schedule, run-occurrence, lock, or checkpoint idempotency semantics changed.

## Cost / observability

- No AWS resource, IAM permission, dependency, DynamoDB table/index, S3 bucket, AgentCore allocation, OpenAI call, Scheduler delivery, or retained Actions artifact is added.
- Successful SELECT steps use the same Browser session and evidence pipeline already allocated for the run.
- Supporting SELECT at Compile avoids wasting Fresh Test/browser/model cost on a control the deterministic runtime can now replay safely.

## Regression coverage

- Compiler coverage proves captured SELECT becomes an explicit SELECT node with the closed side-effect and verification contract while unresolved runtime values remain unmaterialized.
- Compiler coverage continues to prove CHECKBOX and other unsupported controls fail closed and legacy text-input traces remain compatible.
- AWS focused coverage proves exactly one option selection by bound label, transient selected-value output, no post-selection screenshot, exact selected-value verification, and no browser mutation when the runtime input is missing.
- Existing raw-input redaction, INPUT screenshot suppression, submit normalization, collector readiness, tenant isolation, retries, and effect-verification tests remain required.

## Validation

This slice is complete only after GitHub Actions succeeds on the exact published head. Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, all three production package builds, every AWS hosting/federation/release/deployment/demo/OIDC contract, and the complete test suite. Never weaken these checks to obtain green status.

## Known production risks / parked work

- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Checkbox, radio, file-upload, password, and miscellaneous form controls remain intentionally unsupported. They must receive explicit semantics rather than being approximated with TYPE/CLICK.
- SELECT semantic recovery is intentionally not enabled yet because the bound option may be private per-run data; deterministic retry + human escalation is the safe initial product boundary.
- Multi-select controls are not a supported product contract yet and require explicit capture metadata before they can be replayed faithfully.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Repository-level `main` protection remains an operational prerequisite before the first production AWS deployment (Issue #29).
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, protect the trusted `main` boundary, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, wait for authoritative collector readiness, demonstrate the text note + native submit flow, finish trusted completion, and inspect capture evidence;
5. compile/inspect and run a >30-second Fresh Test, verifying timeline/reasoning/evidence and existing SUBMIT-only semantic recovery;
6. publish a near-future recurrence/timezone and verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime with the user device offline;
7. let demo auth expire, verify `WAITING_FOR_HUMAN / TARGET_AUTH_REQUIRED`, repair in Live View, save Browser Profile, resume once, and verify terminal SES/CloudWatch reporting;
8. exercise one ordinary single-select workflow against a controlled test page before broad site support, and prioritize defects exposed by live deployment over speculative recovery hardening.
