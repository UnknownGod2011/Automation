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
- `HumanResumeLeaseHeartbeat` renews during long browser/model operations and permanently fences a worker after rejected or uncertain ownership renewal.

## Validation history before this slice

- CI #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims.
- CI #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- CI #111 passed on `b13d815bf087da799f441991378bb715fcd41c4a` with durable human-resume execution leases and orchestration lease gating.
- CI #112 passed on `2c5cde839a3aebe229942fa5ee7dba5e4e16ea7c` with production human-resume runtime reconstruction.
- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment. This was the validated head before the current slice.
- The execution container cannot resolve `github.com`, so no local install/check/test pass is claimed. GitHub Actions is authoritative.

## 2026-08-19 — Durable redacted human-resume audit trail

### Completed in this slice

- Added provider-neutral `HumanResumeAuditEvent` / `HumanResumeAuditStore` contracts with a deliberately closed schema: event ID, timestamp, lifecycle event type, tenant/user/run/node/resolution identity only. There is no arbitrary metadata or error-text field through which cookies, browser state, DOM values, provider secrets, or lease owner tokens can be accidentally persisted.
- Added audit event validation for required bounded identifiers and ISO-8601 timestamps.
- Wired `HumanResumeOrchestrator` to emit typed lifecycle events for resolution accepted/replayed/conflicted, lease acquired/not-acquired, execution started/succeeded/failed, and lease completed/completion-failed.
- Audit persistence is intentionally derived/best-effort observability rather than a new execution authority. Claim and lease stores remain authoritative; an audit backend outage cannot cause the orchestrator to retry or duplicate a website side effect. Audit failures are reduced to a fixed sanitized warning hook.
- When audit persistence is configured, an explicit audit-event-ID factory is required so event identity does not rely on hidden process-global behavior.
- Added `AwsDynamoHumanResumeAuditStore`. It stores append-only events under a tenant/user-derived + run-scoped partition and timestamp/event-ID sort key, uses a conditional put so a duplicate event cannot overwrite history, and performs strongly consistent ordered reads for a run.
- Added provider-neutral tests proving the exact successful lifecycle event sequence, absence of the private lease owner token, fail-open behavior during audit backend outage, sanitized warnings, and malformed audit-boundary rejection.
- Added AWS adapter tests for append/list ordering, tenant isolation, conditional duplicate rejection, and strongly consistent run-history reads.
- No dependency or third-party source was added.

### Correctness / failure-mode review

- Durable claim acceptance, execution lease ownership, heartbeat fencing, checkpoint state, and browser-profile persistence continue to decide whether execution may proceed. Audit writes never grant execution permission.
- An audit write failure is not retried by re-running the human-resolution command and does not reinterpret `REPLAY`, `CONFLICT`, `BUSY`, lease loss, or execution failure.
- Event IDs are append identity only. A duplicate event key fails instead of overwriting an earlier record; no last-write-wins history mutation is permitted.
- The orchestrator records `EXECUTION_FAILED` without persisting exception text. Detailed operational errors remain in the existing sanitized execution/error channels rather than the durable audit record.
- This slice does not make crash replay safe. It improves the evidence needed to diagnose recovery but cannot prove whether an external website effect completed in the lease-loss window.

### Security / tenancy review

- Audit partitions are derived from tenant + user scope and additionally separated by run ID. Reads require the same ownership scope and validate the embedded event identity before returning data.
- The event contract has no owner-token field and no arbitrary map/payload. Lease owner tokens, browser cookies, auth headers, session storage, provider credentials, raw DOM values, reasoning prompt context, and exception text are excluded by construction.
- Warning callbacks receive only the fixed string `human resume audit persistence failed`; storage error details are not surfaced through this path.

### Timeout, retry, observability, cost, and scaling review

- Audit writes add a small fixed DynamoDB write cost per human-resume lifecycle transition. They do not add browser/model calls.
- Run history uses a dedicated run-scoped partition and ordered sort keys, avoiding table scans. A very large number of human-resume events for one run can still create a hot logical partition; pagination/retention should be added before histories become unbounded.
- Audit backend throttling/transport failure does not widen execution retries and therefore cannot multiply target-site effects. A warning is emitted for external operational telemetry to count dropped audit events.
- Heartbeat-specific events inside `HumanResumeWorker` are still not emitted by this slice; the durable lease state plus orchestration events remain available, but exact periodic-renewal/loss history needs a later worker integration.

### Validation status for this slice

- Code, tests, exports, AWS adapter, and this progress update are intended to be published in one atomic multi-file Git commit using Git data primitives.
- No local validation is claimed because the execution container cannot resolve GitHub/package dependencies.
- GitHub Actions must complete successfully on the exact resulting commit before this slice is considered validated. If CI fails, inspect the failing job logs and root-cause before any corrective commit; do not weaken checks.

### Known risks / unresolved questions

- The unknown-side-effect window remains for an operation already in flight when lease ownership becomes uncertain. Audit history cannot by itself establish whether the target website applied the operation.
- Automatic same-resolution crash recovery after lease expiry remains disabled until durable effect reconciliation/idempotency can verify-before-retry.
- Heartbeat renewal/loss and runtime/profile milestones are not yet connected to the new audit store.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains.
- The AWS SDK peer-version warning still needs deliberate package alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic tests are the current evidence.

### Next highest-value tasks

1. Add durable first-successor effect identity/reconciliation so replacement ownership can classify an interrupted effect as already-applied, definitely-not-applied, or ambiguous before any retry.
2. Extend the redacted audit trail into heartbeat ownership loss, runtime reconstruction, profile persistence, and reconciliation decisions without exposing worker tokens or browser data.
3. Deliberately align AWS SDK peer versions and rerun the full workspace suite.
4. Continue outward through capture -> compile -> test -> publish -> schedule once recovery can reconcile crash ambiguity safely.
