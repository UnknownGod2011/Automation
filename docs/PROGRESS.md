# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed foundation

- Strict TypeScript/pnpm monorepo with deterministic dependency bootstrap, pinned Node/pnpm versions, reviewed lock SHA-256, and the prior AWS DynamoDB peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and in-memory adapters.
- Deep execution/human-recovery substrate: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts and `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, explicit verification, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history UX with same-origin mutation checks.
- AWS transport/IaC define EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- `AgentCoreIdentityCredentialVault` stores BYOK API keys as AgentCore Identity managed API-key credential providers. Raw provider keys stay out of normal application metadata.
- Provider-neutral credential-pool routing selects usable BYOK credentials deterministically, resolves secrets only at model invocation, applies bounded health/cooldown state, suppresses same-provider rotation by default, and supports preflight rejection before browser/model cost.
- Authenticated credential-management APIs and `/settings/credentials` support sanitized create/list/rotate/remove operations while keeping raw keys and vault references server-side.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `335cf0970bac3f3ea52b930991c598ca8f17c276` is green on GitHub Actions CI #153.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — BYOK scheduled-execution composition

### Product slice

Connected the existing BYOK credential pool to the production scheduled-run composition boundary instead of leaving credential management and execution as separate product capabilities.

Added `createAwsByokScheduledExecution`, an AWS-only composition helper that constructs the existing provider-neutral `ScheduledRunCoordinator` and `ScheduledRunWorker` with:

1. an invocation-scope preflight guard,
2. `CredentialPoolPreflightCheck`, so missing/disabled/exhausted credentials stop the run before AgentCore Browser allocation,
3. `CredentialPoolReasoningProvider`, so the selected secret is retrieved only when semantic reasoning is actually invoked, and
4. the existing caller-supplied `CredentialBoundReasoningProviderFactory`, preserving provider-neutral core contracts and leaving concrete provider SDK bindings as the next outward milestone.

Added `AgentCoreRuntimeHeaderWorkloadAccessTokenSource` for the trusted AgentCore Runtime payload header `WorkloadAccessToken`. Header matching is case-insensitive, conflicting duplicate values fail closed, and token size is bounded. The composition is intentionally invocation-scoped: the token is captured only by the in-memory reasoning access-context closure and is never copied into workflow graphs, run records, checkpoints, credential metadata, browser profiles, or user-visible output.

The composition is also bound to the trusted invocation tenant/user. A request accidentally routed through a worker constructed for another ownership scope fails in preflight before browser compute. The same scope check is repeated at reasoning access so the workload token cannot be used to resolve a credential for another tenant even if a caller bypasses the normal worker path.

### Security / tenancy / idempotency / concurrency / retry / verification / cost review

- Raw provider keys still flow only through `CredentialVault`; this slice adds no secret persistence and no new dependency.
- The AgentCore workload access token is operational capability material. It is read from the trusted invocation boundary, retained only in memory, and excluded from errors, logs, metadata, checkpoints, and run history by construction.
- Tenant/user identity is bound when the AWS scheduled execution composition is created and checked again before secret resolution. Cross-scope reuse fails before AgentCore Browser/model cost.
- BYOK preflight executes before the existing automation lock/browser startup path. A user with no usable credential gets the existing durable `WAITING_FOR_HUMAN / NOT_CONFIGURED` state rather than a paid browser session that can never reason.
- Scheduled occurrence idempotency and automation locking remain unchanged and authoritative. Credential health remains advisory and cannot authorize or duplicate browser side effects.
- Provider fallback behavior remains unchanged: same-provider key rotation is disabled unless explicitly opted in, and a failed reasoning call is not automatically replayed against another key.
- Model/browser side effects remain governed by the existing workflow action constraints and verification engine. This composition does not broaden any allowed action.
- Existing bounded workflow retries/timeouts remain in force. Concrete provider-bound reasoners still need their own bounded network timeout implementations before live BYOK model traffic is considered complete.
- No new per-run DynamoDB write is introduced beyond the existing credential preflight list/read and health bookkeeping. The preflight intentionally trades a small metadata read for avoiding unnecessary AgentCore Browser/model allocation.

### Tests added

Regression coverage now proves:

- missing BYOK credentials block scheduled execution before browser session creation,
- the runtime `WorkloadAccessToken` is accepted case-insensitively but missing/conflicting/oversized capability material fails closed,
- the workload token is passed only to vault access when reasoning is invoked and does not appear in credential metadata,
- cross-tenant reuse of an invocation-scoped worker is rejected before browser compute or secret retrieval.

### Validation status

- This run publishes one normal CI-triggering multi-file Git-data commit containing implementation, tests, AWS exports, and this progress update.
- No package manifest or lock snapshot change is required.
- Exact-head GitHub Actions is pending at commit time and remains the only authority for declaring the slice green. One corrective commit is permitted only after a concrete CI failure is root-caused from the Actions logs.

## Next product milestones

1. Add concrete provider-bound BYOK reasoners behind `CredentialBoundReasoningProviderFactory` with explicit provider timeouts and sanitized failure classification. Start with one production provider needed for the demo rather than building a broad provider catalog.
2. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states and stable run correlation identifiers.
3. Compose/deploy the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions execution stack behind explicit environment/IaC outputs.
4. Perform one controlled real AWS demonstration covering sign-in -> credential setup -> capture -> compile/test -> publish -> scheduled cloud browser execution -> reasoning -> verification/history and one bounded human takeover/resume path.
5. Add Google federation to Cognito once deployment-owned Google OAuth credentials are available; never hard-code them in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The new scheduled BYOK composition expects the trusted deployment/runtime adapter to construct it once per AgentCore invocation with the runtime-provided workload token. The actual Lambda/AgentCore handler composition is still a deployment milestone.
- Concrete provider-bound reasoners are not yet implemented behind `CredentialBoundReasoningProviderFactory`; therefore BYOK routing is now connected to scheduled execution but live third-party model invocation still depends on the next adapter slice.
- Credential health metadata has no compare-and-set generation; concurrent reasoning calls may race advisory health bookkeeping. It is not execution authority and cannot duplicate browser effects.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
