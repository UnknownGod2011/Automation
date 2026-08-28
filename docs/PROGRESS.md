# Production Progress

Updated: 2026-08-28

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `4bafd065a66658ea711dfc7c65799934718219a9` (`Add bounded live browser observations for semantic recovery`), and push CI #402 completed successfully on that exact SHA. The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with bounded live observations for constrained semantic fallback, mandatory effect verification, authenticated capture/run evidence, run history/reasoning, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — controlled semantic selector drift

### Product milestone

The runtime can now recover from harmless UI drift with bounded live browser observations, but the first-party AWS demo could still prove only the deterministic path. A production demo needs a controlled way to invalidate the captured submit target while preserving the exact same harmless form side effect so OpenAI BYOK recovery and mandatory verification can be demonstrated end to end.

### Change

- Added opt-in `AUTOMATION_DEMO_TARGET_SEMANTIC_DRIFT_ENABLED`, defaulting to false and rejecting malformed values.
- Added CloudFormation `DemoTargetSemanticDriftEnabled`, default false, and wired it only into the web Lambda environment. No new IAM or AWS data-plane authority is introduced.
- Baseline teaching remains unchanged: capture uses the in-form `button[data-testid=demo-submit]` labelled `Complete demo task`.
- Drift mode removes that captured element and renders a form-associated `input[type=submit]` outside the form with test-id `demo-semantic-submit` and accessible name `Finish controlled demo after selector drift`.
- The form action, accepted fields, authentication boundary, non-reflection behavior, and completion response are identical in both modes.
- The deployment smoke now reads the immutable environment contract and requires the baseline or drift fixture that configuration claims is deployed; a mismatch fails closed.
- The AWS vertical runbook now requires capture/compile with drift disabled, then redeployment of the same immutable release with drift enabled before Fresh Test, and requires observable SUBMIT semantic recovery before claiming the BYOK recovery milestone.

### Security / tenant isolation / side effects

The fixture is first-party, disabled by default, and has no AWS data-plane permission or durable application state. It does not alter tenant/user/profile/credential selection, Browser authority, model authority, or workflow side-effect policy. The replacement submit control posts the same harmless form exactly once; semantic recovery remains restricted by the immutable SUBMIT-only node and the existing structural completion verification must still pass before execution advances. The new flag is non-secret deployment configuration and is never request-selectable by an automation user.

### Idempotency / concurrency / retry / timeout

No run identity, occurrence key, automation lock, lease, heartbeat, retry budget, Scheduler delivery, workflow checkpoint, or persistence transition changed. The fixture only changes server-rendered target markup. Existing bounded deterministic attempts, semantic recovery, and human escalation remain authoritative.

### Cost / observability / user recovery

No dependency, Browser/AgentCore session, queue, database, S3 object, model call, or retained Actions artifact is added by configuration alone. When the live proof is executed, one semantic model request is expected only because deterministic targeting was deliberately made stale. The existing reasoning timeline and verification evidence are the required proof. Target-auth expiry and secure Profile repair/resume remain unchanged.

### Regression coverage / validation

Web unit coverage proves the drift flag is false by default, malformed values fail closed, baseline markup remains stable for capture, drift markup removes the captured submit target, and the replacement stays associated with the same form without exposing secret fields. The web-hosting contract locks the new CloudFormation parameter/environment mapping. The no-cloud AWS smoke contract exercises both baseline and drift configurations and rejects a deployment whose rendered fixture does not match its declared drift mode.

This batched change intentionally contains no dependency-manifest update. GitHub Actions on the exact published head remains authoritative; do not claim this slice green until that run completes successfully.

## Known production risks / intentionally parked work

- `main` remains unprotected until an administrator applies/verifies the existing branch-protection helper (or configures an equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Require exact-head CI green for this controlled semantic-drift slice and promote only after validation.
2. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
3. Run the immutable AWS deployment with the built-in target enabled and semantic drift disabled; require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
4. Execute Capture -> Compile on the stable target, then redeploy the same immutable release with semantic drift enabled.
5. Run guided >30-second Fresh Test and prove deterministic SUBMIT drift -> bounded live observation -> OpenAI BYOK SUBMIT-only decision -> exactly one recovered activation -> existing completion verification.
6. Publish and prove Scheduler/SQS/Step Functions/AgentCore cloud execution, SES/CloudWatch reporting, then controlled target-auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
