# Production Progress

Updated: 2026-08-28

## Current validated baseline

`main` is `5f3447bdc5e9c4449146a795fb778768cfbb5830` (`Add explicit semantic recovery proof view`). PR CI #405 passed on the exact pre-merge content, but push CI #406 failed on this exact `main` SHA at the deterministic pnpm lock-snapshot gate before installation/check/tests. The failure was real and isolated: pnpm 10.15.0 re-resolved the unchanged workspace manifests from the live registry to lock SHA `ecbd5c08c99ee9e8a92372f12f44115beb2d7626999538f09cc9c1e0f752ad40` instead of the previously reviewed `4354be9e6660a24ec9a42bea1010e9e372b9ce61f7085109bd01f95413a3f473`.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with bounded live observations for constrained semantic fallback, mandatory effect verification, authenticated capture/run evidence, run history/reasoning, SES/CloudWatch reporting, bounded target-auth takeover/resume, controlled semantic selector drift, and explicit semantic-recovery proof presentation.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — deterministic checked-in pnpm lock bootstrap

### Product / build milestone

CI #406 exposed that the current supply-chain gate is not actually reproducible: it deletes `pnpm-lock.yaml`, resolves the public registry afresh, and compares the generated file to a manually refreshed hash. An unrelated transitive publication can therefore turn a previously green exact tree red without any repository change. The commit history contains repeated lock-snapshot refreshes, confirming this is systemic rather than a one-off defect.

### Change in this bootstrap commit

- Root-caused CI #406 from the authoritative job log; no product code or dependency manifest changed.
- Updated the temporary bootstrap hash only to the exact graph CI #406 resolved (`ecbd5c08...`).
- The bootstrap gate emits the lockfile only after that exact hash and the existing AWS SDK/DynamoDB peer-alignment assertions pass.
- This emitted lock is dependency metadata only; it contains no application secrets, browser/session state, BYOK material, tenant data, or runtime inputs.
- The corrective commit in this same development run will check that exact lockfile into Git and replace live-registry re-resolution with deterministic repository-lock verification. The bootstrap emission will then be removed.

### Security / tenant isolation / concurrency / cost

No runtime behavior, execution authority, tenant boundary, retry/timeout, scheduler/queue behavior, Browser session, model call, DynamoDB/S3 data, IAM permission, or user-visible workflow behavior changes in this bootstrap. The only temporary cost is one normal CI run needed to materialize the already-authenticated dependency snapshot; no Actions artifact is retained.

### Validation

GitHub Actions on the exact branch head is authoritative. Do not treat this bootstrap or the final checked-in-lock strategy as green until their corresponding CI runs complete successfully.

## Known production risks / intentionally parked work

- `main` remains unprotected until an administrator applies/verifies the existing branch-protection helper (or equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Finish the deterministic checked-in pnpm lock correction and require exact-head CI green.
2. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
3. Run the immutable AWS deployment with the built-in target enabled and semantic drift disabled; require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
4. Execute Capture -> Compile on the stable target, redeploy the same immutable release with semantic drift enabled, and run guided >30-second Fresh Test.
5. Require deterministic SUBMIT drift -> bounded live observation -> OpenAI BYOK SUBMIT-only decision -> exactly one recovered activation -> existing completion verification -> `VERIFIED` semantic-recovery proof view.
6. Publish and prove Scheduler/SQS/Step Functions/AgentCore cloud execution, SES/CloudWatch reporting, then controlled target-auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
