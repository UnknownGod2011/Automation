# Production Progress

Updated: 2026-08-28

## Current validated baseline

`main` is `26822252abebeb611ca1472a5950fdeed6b4ad85` (`Add controlled semantic selector drift demo`), and push CI #404 completed successfully on that exact SHA. The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with bounded live observations for constrained semantic fallback, mandatory effect verification, authenticated capture/run evidence, run history/reasoning, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — explicit semantic recovery proof presentation

### Product milestone

The controlled target can now force a harmless selector drift and the durable run already stores sanitized semantic-recovery summaries, but operators still had to infer the proof by combining the reasoning timeline with terminal run status. The live AWS demo needs an explicit fail-closed proof view that distinguishes “semantic recovery occurred” from “semantic recovery occurred and the run subsequently reached verified terminal success.”

### Change

- Added a provider-neutral `semanticRecoveryProof` presentation helper. It counts only persisted summaries whose trigger is `SEMANTIC_RECOVERY`.
- `SUCCEEDED` plus at least one recovery summary yields `VERIFIED`; any non-success state with recovery yields `OBSERVED`; no recovery summary yields `NOT_USED`.
- Added an authenticated run-scoped `/semantic-recovery-proof` page that displays those states without exposing selectors, live page observations, runtime inputs, provider rationale, credentials, Browser Profile/session identifiers, or hidden chain-of-thought.
- The proof page is deliberately presentation-only. It does not execute, retry, reason, inspect the browser, or create a second verification authority. Terminal run success remains authoritative because the execution engine already requires ordinary post-effect verification before it can complete.

### Security / tenant isolation / idempotency / cost

The page uses the existing authenticated tenant-scoped run lookup. No client-provided credential/profile/workflow identifiers are introduced. No persistence shape, run transition, retry budget, lease, scheduler delivery, model call, Browser session, DynamoDB write, S3 object, queue message, or AWS permission is added. A refresh is read-only and idempotent.

### Regression coverage / validation

Unit coverage proves: workflow reasoning alone does not claim semantic recovery; recovery during RUNNING/FAILED remains observed but unverified; only terminal `SUCCEEDED` with a semantic-recovery summary yields verified proof. GitHub Actions on the exact published head remains authoritative; do not claim this slice green until that run completes successfully.

## Known production risks / intentionally parked work

- `main` remains unprotected until an administrator applies/verifies the existing branch-protection helper (or equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Require exact-head CI green for this semantic-recovery proof slice and promote only after validation.
2. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
3. Run the immutable AWS deployment with the built-in target enabled and semantic drift disabled; require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
4. Execute Capture -> Compile on the stable target, redeploy the same immutable release with semantic drift enabled, and run guided >30-second Fresh Test.
5. Require deterministic SUBMIT drift -> bounded live observation -> OpenAI BYOK SUBMIT-only decision -> exactly one recovered activation -> existing completion verification -> `VERIFIED` semantic-recovery proof view.
6. Publish and prove Scheduler/SQS/Step Functions/AgentCore cloud execution, SES/CloudWatch reporting, then controlled target-auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
