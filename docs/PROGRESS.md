# Production Progress

Updated: 2026-08-28

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `b2248bf85aa0a5e25fc74a1a386720a4a6c0b429` (`Verify captured TYPE against bound value`). The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with constrained semantic fallback, mandatory effect verification, authenticated capture/run evidence, run timeline/reasoning/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — bounded live browser observations for semantic recovery

### Product blocker

Deterministic selector drift could enter semantic recovery with essentially no live page context. Captured CLICK/SUBMIT nodes normally have no bound runtime inputs, so the OpenAI reasoner received the workflow goal, closed current-step intent, and immutable allowed action but had no safe description of the replacement controls currently visible in the browser. The deterministic-first -> semantic-recovery architecture therefore existed, but could be ineffective on the exact UI-drift case it is meant to recover.

### Change

- Added a provider-neutral `SemanticBrowserObservation` contract to the core browser-action boundary.
- Observation data is transient and may accompany a deterministic `ELEMENT_NOT_FOUND` result only when the immutable node is configured for `SEMANTIC_RECOVERY`.
- The workflow engine passes that observation to the reasoner under `browserObservation` while preserving the existing immutable `allowedActions` authority and normal post-action verification.
- The AWS Playwright runtime now captures a bounded observation-only page view at the failed deterministic target boundary.
- Safe page metadata is limited to HTTP(S) origin and bounded title; query strings/fragments are never included.
- Visible interactive metadata is capped at 32 entries and restricted to a closed role set with bounded accessible name and/or test-id.
- The browser-side observation collector never reads input values, cookies, local/session storage, DOM HTML, screenshots, credentials, Browser Profile/session identity, tenant/user identity, BYOK material, workload tokens, or raw exceptions.
- Observation collection failure is sanitized and fail-closed; semantic reasoning does not proceed with broadened authority.
- The observation payload is not merged into workflow outputs/checkpoints and is therefore not persisted by the execution engine.

### Security / tenant isolation / prompt injection

Ownership and execution authority are unchanged. Website-controlled names/titles are explicitly untrusted observation data; the existing OpenAI system prompt already states that browser/page context is data, never instructions. Allowed actions still come only from the immutable workflow node. In particular, a captured submit node remains `SUBMIT`-only through recovery, and page text cannot authorize CLICK, navigation, script execution, or a new workflow destination.

The observation schema intentionally has no field capable of representing input values or browser/session/profile credentials. String lengths, role set, item count, and serialized byte size are bounded before the payload reaches the model adapter.

### Idempotency / concurrency / retry / timeout

No run ID, occurrence key, automation lock, lease, heartbeat, retry budget, Scheduler behavior, or persistence transition changed. Observations are collected only after deterministic target resolution has failed and before any semantic side effect. If observation collection itself fails, no semantic action is dispatched. Existing bounded node retry/human escalation remains authoritative.

### Side-effect verification / user recovery

This slice does not make model output authoritative. The model still chooses exactly one action from the immutable allowed-action enum, the semantic Playwright executor still validates/executes only constrained primitives, and the existing node verification contract must pass before the workflow advances. A recovered target therefore cannot manufacture success merely because the model found something clickable.

### Cost / observability

No AWS resource, IAM permission, dependency, extra Browser/AgentCore session, queue delivery, S3 artifact, retained GitHub Actions artifact, or additional model request was added. The only incremental work is one bounded in-page observation scan when deterministic execution has already failed and semantic recovery is actually configured. This should reduce wasted retries/human intervention for harmless selector drift.

### Regression coverage / validation

Core coverage now forces a compiled captured SUBMIT into deterministic selector drift, supplies a replacement button through the transient observation boundary, and proves:

- the reasoner still receives only `SUBMIT` authority;
- the global workflow goal and closed current-step objective remain intact;
- safe live browser metadata reaches the reasoner;
- Browser Profile identity does not;
- the constrained semantic target is executed exactly once;
- ordinary effect verification still gates success;
- a forged generic CLICK decision remains policy-blocked before semantic browser dispatch.

AWS coverage proves observation normalization removes URL query/fragment data and arbitrary value fields, filters unsupported roles, caps interactive entries, and surfaces browser-observation failure only through a fixed classified error.

GitHub Actions on the exact published head is authoritative; this document must not be read as claiming a pass before that run exists and completes successfully.

## Known production risks / intentionally parked work

- `main` is still unprotected until an administrator applies/verifies the existing branch-protection helper (or configures an equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Require exact-head CI green for this semantic-observation slice and promote only after validation.
2. Add an opt-in harmless selector-drift mode to the controlled first-party demo target so the real AWS vertical proves OpenAI BYOK semantic recovery rather than only deterministic execution.
3. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
4. Run the manual immutable AWS deployment and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
5. Execute the controlled vertical: Cognito/Google -> OpenAI BYOK -> AgentCore Live View capture -> deterministic target drift -> bounded semantic recovery -> verified action -> guided >30-second Fresh Test -> guided Publish -> Scheduler/SQS/Step Functions/AgentCore -> SES/CloudWatch -> controlled auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
