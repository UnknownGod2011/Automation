# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict pnpm/TypeScript monorepo with shared `@automation/contracts` domain boundary.
- Versioned workflow graphs, run/checkpoint records, bounded retry/backoff, failure classification, verification requirements, occurrence idempotency, and multi-tenant ownership.
- Provider-neutral repositories/ports plus deterministic in-memory adapters.
- Guarded run lifecycle state transitions, scheduled-run idempotency, automation concurrency leases, retry fingerprints/circuit breaking, semantic fallback constraints, and explicit effect verification.
- Provider-neutral execution engine preserving immutable workflow version, variables, evidence, and checkpoints across retry/pause/resume.
- AWS DynamoDB/S3/browser-profile/session/identity/reasoning/Playwright adapters remain behind provider-neutral contracts.
- Explicit `HUMAN` workflow nodes support pause -> human repair -> resume -> declared successor -> success; ambiguous branching is rejected before leaving `WAITING_FOR_HUMAN`.
- Durable human-resolution claims use stable resolution IDs and atomic conditional persistence. Same-ID delivery is `REPLAY`; competing delivery is `CONFLICT`.
- `HumanResumeOrchestrator` executes only newly `ACCEPTED` claims and requires a durable human-resume execution lease before browser/model work.
- Human-resume execution leases are tenant/user/run/node/resolution scoped, have opaque owner tokens, support conditional renewal, and complete into durable tombstones. AWS uses conditional DynamoDB writes and strongly consistent contention reads.
- `HumanResumeWorker` reconstructs the immutable workflow/browser profile, revalidates ownership, refuses disabled automations, renews before checkpoints/profile persistence, and prevents profile-save failure from being reported as durable success.

## Validation history before this slice

- CI #95 passed on `1dc9ad43b32d628d81f50bb83a221b88321c1359` after Playwright package/import fixes and explicit-HUMAN resume regression coverage.
- CI #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims.
- CI #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- CI #111 passed on `b13d815bf087da799f441991378bb715fcd41c4a` with durable human-resume execution leases and orchestration lease gating.
- CI #112 passed on `2c5cde839a3aebe229942fa5ee7dba5e4e16ea7c` with production human-resume runtime reconstruction.
- The execution container cannot resolve `github.com`, so no local install/check/test pass is claimed. GitHub Actions is authoritative.

## 2026-08-19 — Human-resume lease heartbeat and operation fencing

### Completed in this slice

- Added provider-neutral `HumanResumeLeaseHeartbeat`; no AWS/GCP type or new dependency was introduced.
- Timer-driven and boundary-driven renewals share one serialized renewal promise, preventing concurrent renewal responses from regressing the in-memory lease state.
- The heartbeat renews periodically while resumed browser/model execution is active, closing the checkpoint-only renewal gap for long-running operations.
- Any rejected or uncertain renewal permanently marks ownership lost for that worker. The ownership-loss error is deliberately sanitized and does not include the owner token or underlying storage error text.
- `HumanResumeWorker` now validates `leaseHeartbeatIntervalMs`; it must be positive and strictly smaller than `leaseTtlMs`. The default is approximately one third of the TTL.
- Browser-session start, runtime creation, deterministic browser actions, semantic reasoning, semantic browser actions, verification, checkpoint writes, success profile persistence, and pause/failure profile persistence are fenced through the same ownership guard.
- Every fenced external operation performs an immediate renewal before starting. Periodic renewal continues while the operation is in flight. When the operation returns, the worker rejects its result if heartbeat ownership was lost before allowing another effect.
- Once ownership is lost, later browser/model/verifier/checkpoint/profile operations cannot start. Ephemeral runtime/session cleanup remains allowed because it only tears down the stale worker's own resources.
- Added deterministic tests for concurrent-renewal serialization, renewal during a long operation, permanent post-loss fencing, suppression of later operations, sanitized ownership-loss messages, and invalid heartbeat interval rejection.
- Updated `ARCHITECTURE.md` and `QUALITY_GATES.md` with heartbeat semantics, validation requirements, failure limitations, and cost/scaling expectations.

### Invariants and failure-mode review

- Durable lease ownership remains the authority; the heartbeat is only a renewal/fencing mechanism and cannot manufacture ownership.
- Storage rejection, transport failure, throttling, or any other uncertain renewal outcome fails closed. No retry outcome is guessed.
- Timer and explicit renewals cannot overlap at the adapter boundary because the heartbeat serializes them.
- Heartbeat loss is terminal for the worker instance even if a later storage call might have succeeded; this avoids a stale process oscillating back into execution permission.
- A heartbeat cannot retroactively cancel an external effect already in flight when ownership becomes uncertain. Its returned result is discarded and every subsequent effect is fenced, but the external system may already have observed the effect.
- Automatic same-resolution crash recovery therefore remains disabled until effect reconciliation/idempotency can resolve that unknown-side-effect window.
- Workflow retry budgets are unchanged. Heartbeat/lease failures escape the execution path instead of being widened into generic node retries.

### Security and tenant isolation review

- The heartbeat operates only on the already validated tenant/user/run/node/resolution lease supplied to the worker; it does not accept client-selected resource identifiers.
- Lease owner tokens remain capability material used only by durable compare-and-set persistence and are not included in heartbeat error messages, logs, user-visible histories, or evidence.
- No browser cookies, auth headers, provider keys, DOM secrets, session storage, or profile payloads are newly persisted.
- Profile persistence after ownership loss is forbidden, preventing a stale worker from overwriting the profile state of a newer owner.

### Timeout, observability, cost, and scaling review

- Default heartbeat frequency is roughly three renewals per lease TTL while a human-resume worker is active, plus immediate boundary renewals. This intentionally increases DynamoDB writes to reduce stale-owner risk during expensive browser/model work.
- The interval is explicit so production deployments can balance storage latency, service quotas, and lease TTL. It must remain comfortably below TTL; the constructor rejects unsafe interval >= TTL configurations.
- Heartbeat timers are stopped before cleanup, so completed/failed workers do not continue lease write traffic while closing runtime resources.
- Structured durable audit events for heartbeat renewal/loss remain missing; current ownership-loss exceptions are sanitized but not yet emitted into a first-class audit stream.

### Validation status for this slice

- All code/tests/docs are intended to be published in one atomic multi-file Git commit using Git data primitives.
- No local validation is claimed because the execution container cannot resolve GitHub/package dependencies.
- GitHub Actions must complete successfully on the exact resulting commit before this slice is considered validated. If CI fails, inspect the failing job logs and root-cause before any corrective commit; do not weaken checks.

### Known risks / unresolved questions

- The unknown-side-effect window still exists for the operation that was already in flight at the instant lease ownership became uncertain. Heartbeat fencing prevents later effects but cannot undo that external operation.
- Automatic crash recovery after lease expiry remains intentionally disabled until node-level effect reconciliation/idempotency can verify-before-retry.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains.
- Structured redacted audit events for human pause/claim/lease/heartbeat/resume lifecycle are not yet persisted.
- The AWS SDK peer-version warning still needs deliberate package alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic tests are the current evidence.

### Next highest-value tasks

1. Add durable first-successor effect reconciliation/idempotency so same-resolution recovery after a crashed worker can verify whether the external effect already occurred before deciding to retry.
2. Add structured, redacted audit events for human pause, resolution claim, lease acquisition/renewal/loss/completion, heartbeat ownership loss, runtime reconstruction, successor start, and completion/failure.
3. Deliberately align AWS SDK peer versions and rerun the full workspace suite.
4. Continue outward through capture -> compile -> test -> publish -> schedule once the recovery path can reconcile crash ambiguity safely.
