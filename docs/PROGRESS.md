# Production Progress

Updated: 2026-08-28

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `c5b72f59f28e96decdf0a5c30d64353137243733` (`Clarify compiled capture step intent`), and push CI #394 completed successfully on that exact SHA. There were no open pull requests. GitHub still reports `main.protected=false`; the fail-closed deployment workflow must continue issuing zero AWS credentials until repository protection is actually configured.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with constrained reasoning fallback, mandatory effect verification, authenticated capture/run evidence, run timeline/reasoning/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — verify TYPE against the bound value

### Product defect

Captured text-entry nodes currently use the custom verification contract `capture:input-filled`. Production Playwright verification interpreted that as only “the field is non-empty.” A browser/page could therefore transform, reject, or replace a submitted value and still satisfy verification as long as some non-empty text remained. That is weaker than the deterministic intent already available to the executor and can produce a false successful Fresh Test or scheduled run.

This matters directly to the controlled AWS vertical because its TYPE step is a privacy-preserving per-run input. Verification should prove the browser contains the value the action actually attempted to place, not merely that the control contains something.

### Change

- Deterministic TYPE execution now returns the bound typed value only as a transient `typedValue` action output after `fill()` succeeds.
- Constrained semantic TYPE fallback returns the same transient output after its bounded fill operation.
- `capture:input-filled` verification for a TYPE node now requires that transient bound value and compares it exactly with Playwright `inputValue()`.
- An intentionally empty bound value verifies successfully only when the browser is also empty; the previous non-empty-only contract could not express this valid case.
- Missing transient TYPE output fails verification closed instead of falling back to a weak non-empty check.
- Compatibility is preserved for legacy non-TYPE nodes that may still carry `capture:input-filled`: those continue using the older non-empty behavior. Dedicated SELECT and CHECK verification contracts are unchanged.
- TYPE action and verification screenshots remain suppressed.

The compiler contract remains compatible: existing immutable workflows using `capture:input-filled` automatically receive the stronger TYPE semantics when executed by the updated production runtime, so no workflow-version migration is required.

### Security / tenant isolation / privacy

No ownership or authorization boundary changes. The typed value already exists in the run’s authorized input/checkpoint variables; this slice does not add it to workflow graphs, evidence metadata, screenshots, logs, notifications, Browser Profiles, or user-facing diagnostics. `typedValue` is an in-memory action output consumed by verification. Captured TYPE nodes have no output binding, so the verifier result does not create a new durable workflow variable.

The existing warnings remain applicable: Fresh Test inputs can enter durable checkpoint state and must not contain passwords, OTPs, API keys, tokens, or authentication secrets. Target-site authentication remains in the Browser Profile/human-auth path.

### Idempotency / concurrency / retry / timeout

No run identity, occurrence key, lock, lease, heartbeat, retry budget, schedule, capture claim, or persistence transition changes. Exact verification runs inside the existing bounded node verification timeout. A mismatch remains `EFFECT_NOT_VERIFIED` and follows the existing bounded retry/escalation policy.

### Side-effect verification / user recovery

This strengthens verification without broadening browser authority. TYPE remains constrained to the immutable node target/action. Semantic fallback remains allowed only through the existing TYPE action boundary. A page transformation that changes the typed value now fails verification rather than being accepted as success, after which existing retry/human escalation applies.

### Cost / observability

No AWS resource, IAM permission, dependency, AgentCore Browser/Runtime allocation, S3 write, model request, queue delivery, retained Actions artifact, or additional network call is introduced. Verification performs one `inputValue()` read on the already-open page, replacing a weaker read of the same control. Screenshot suppression remains intact, so there is no evidence-storage cost increase.

### Regression coverage / validation

New AWS Playwright coverage proves:

- deterministic TYPE returns the transient bound value and takes no screenshot;
- exact browser value verifies successfully;
- a different non-empty browser value fails verification;
- intentionally empty text can verify exactly;
- missing transient bound value fails closed for TYPE;
- constrained semantic TYPE fallback returns the same transient verification value without screenshots;
- browser-side transformation is detected rather than accepted as merely populated.

Normal implementation commit: `12d2e148693d37c85abd03448fad43aa816118ac` (`Verify captured TYPE against bound value`). CI #395 passed deterministic lock verification, frozen installation, strict `pnpm check`, all three production packaging paths, and every AWS deployment/security/demo/OIDC/main-protection contract. The full suite then failed on exactly one stale AWS regression in `playwright-runtime.test.ts`: it invoked the strengthened TYPE verifier with `outputs: {}` and still expected the legacy non-empty contract to pass. The new dedicated TYPE tests all passed, and production code was not implicated by that failure.

The single corrective commit updates only that legacy test fixture to provide `{ typedValue: "runtime-secret-value" }`, matching the transient output that deterministic/semantic TYPE execution supplies in production. No verifier behavior or safety gate is weakened. GitHub Actions on the corrective exact head remains authoritative; this document must not be read as claiming green validation before that run completes successfully.

## Known production risks / intentionally parked work

- `main` is still unprotected until an administrator applies/verifies the existing branch-protection helper (or configures an equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Promote this slice only after exact-head CI is green.
2. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
3. Run the manual immutable AWS deployment and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
4. Execute the controlled vertical: Cognito/Google -> OpenAI BYOK -> AgentCore Live View capture -> trusted completion/evidence -> Compile/inspect -> guided >30-second Fresh Test -> guided Publish -> Scheduler/SQS/Step Functions/AgentCore -> SES/CloudWatch -> controlled auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
