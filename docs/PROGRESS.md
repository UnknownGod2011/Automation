# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict pnpm/TypeScript monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, and tenant ownership.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit `HUMAN` pause -> repair -> resume lifecycle with immutable workflow-version pinning and no guessed human branching.
- Atomic human-resolution claims, durable execution leases, heartbeat fencing, redacted audit history, and AWS conditional persistence.
- Durable first-successor effect reconciliation with stable effect identity and immutable `ALREADY_APPLIED` / `DEFINITELY_NOT_APPLIED` / `AMBIGUOUS` authority.
- Provider-neutral read-only reconciliation coordinator plus AWS observation-only Playwright verifier. Positive expected-state evidence can establish `ALREADY_APPLIED`; current positive-only verification contracts cannot establish `DEFINITELY_NOT_APPLIED`.
- Pure `planAlreadyAppliedHumanResumeRecovery` reconstruction of the successful first-successor checkpoint without replaying the external action.

## Recent authoritative validation

- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with durable redacted human-resume audit history.
- CI #116 passed on `b09a32fda4bfe0b2cb7957395ff69e4f94310545` with durable effect reconciliation authority.
- CI #118 passed on `f22d0e1402d5ba3659d6ad3c2362e70c5f3e768f` with the provider-neutral read-only reconciliation boundary.
- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only reconciliation verifier.
- CI #120 passed on `47b7d4805d6a10c7f405bab73d386d94bc14b15b` with provider-neutral `ALREADY_APPLIED` checkpoint reconstruction. This is the validated incoming head for the current slice.
- The execution container has no authenticated GitHub CLI/local checkout path, so no local install/check/test pass is claimed. GitHub Actions on the exact published head remains authoritative.

## 2026-08-19 — Lease-owned atomic ALREADY_APPLIED recovery transition

### Completed in this slice

- Added provider-neutral `HumanResumeAlreadyAppliedTransitionStore` plus `HumanResumeAlreadyAppliedTransitionRequest` / result contracts.
- Added `assertAlreadyAppliedRecoveryTransition`, which independently validates tenant/user scope, the exact paused run/checkpoint identity, durable `DECIDED / ALREADY_APPLIED` reconciliation identity, a matching active same-resolution execution lease, lease expiry at commit time, monotonic checkpoint time, and cleared retry/failure state.
- Added `buildAlreadyAppliedRecoveryRun`, which derives the only permitted paired run mutation: `WAITING_FOR_HUMAN` -> `RUNNING` at the reconstructed checkpoint node while preserving immutable run identity and removing stale human failure/finalization fields. Callers do not provide an arbitrary next run record.
- Added `AwsDynamoHumanResumeAlreadyAppliedTransitionStore`. It uses one DynamoDB transaction containing a live-lease condition check plus conditional replacement of the paused run and paused checkpoint. Run and checkpoint therefore advance together or neither advances.
- The AWS transaction checks the exact lease owner token/resolution/state/expiry, exact paused run status/node/immutable identity, and exact paused checkpoint node/updatedAt/version before writing the recovered pair.
- Successful writes stamp an internal recovery-transition ID on both DynamoDB items. A later exact duplicate that loses the conditional race performs strongly consistent reads and returns `REPLAY` only when both durable items carry that exact transition ID and expected recovered state; otherwise it returns `CONFLICT`.
- DynamoDB transaction tokens include the worker owner token and commit instant as well as recovery identity. This avoids `IdempotentParameterMismatch` when a replacement worker later owns the same logical recovery boundary with different lease-condition values.
- `TransactionCanceledException` is treated as a normal contention outcome only when cancellation reasons show conditional-check failure and no non-conditional error. Throttling/transport/permission/unknown transaction uncertainty propagates rather than being guessed as `REPLAY` or `CONFLICT`.
- Added provider-neutral regression tests for derived run state, expired/mismatched lease rejection, reconciliation drift, tenant isolation, stale checkpoint identity, retry-state clearing, and timestamp monotonicity.
- Added AWS regression tests for atomic run+checkpoint advancement, exact duplicate replay with strongly consistent reads, stale-state conflict, lost lease ownership, tenant isolation, and propagation of transport/non-conditional transaction cancellation failures.
- Exported the new core and AWS boundaries. No dependency or third-party source was added.

### Invariants / failure semantics

- This transition is persistence authority, not action-execution permission. It is only valid after a durable `ALREADY_APPLIED` decision and while the caller still owns the exact live execution lease.
- The paused run and checkpoint are compared at commit time, not trusted from an earlier read. A stale worker cannot independently overwrite either half of recovery.
- The transaction changes no external website state. If it conflicts, the caller must re-read durable authority rather than retrying the already-applied action.
- Storage uncertainty is fail-closed. Only a proven conditional race can be classified; network/throttling/permission uncertainty is surfaced.
- Worker owner tokens are used only in the conditional lease check and deterministic transaction token; they are not copied into run/checkpoint payloads or user-visible history.
- The internal recovery-transition ID is derived from hashed scoped recovery identity; it is operational metadata and contains no raw browser content, credentials, DOM data, or exception text.

### Concurrency / idempotency / scaling review

- Concurrent workers cannot split run/checkpoint advancement because the two replacements and lease ownership check share one DynamoDB transaction.
- Exact same-request redelivery becomes `REPLAY` only after strongly consistent verification of both items. A different reconstructed checkpoint, lease owner, commit instant, or stale durable state cannot masquerade as that replay.
- The transaction costs one DynamoDB transactional write across three items; conditional contention may add two strongly consistent reads. This is intentionally paid only in crash recovery, not the healthy execution path.
- No new queue, model call, browser call, table, or dependency was introduced.

### Security / tenant isolation

- Scope is validated in core before any storage operation. AWS keys remain partitioned by tenant+user-derived scope digest.
- Effect, lease, run, and checkpoint identities must all agree on run and pause boundary.
- The next run record is derived internally; clients cannot use the transition to rewrite tenant identity, occurrence identity, workflow version, or arbitrary run status.

### User-visible recovery impact

- Once worker integration is added, an `ALREADY_APPLIED` crash recovery can advance durable state without repeating the website action and without risking checkpoint/run split-brain.
- This slice deliberately does not yet enable automatic lease reacquisition or invoke the transition from `HumanResumeWorker`; no production crash replay behavior changed yet.

### Validation status for this slice

- Incoming head `47b7d4805d6a10c7f405bab73d386d94bc14b15b` is confirmed green via GitHub Actions CI #120.
- The coherent code/tests/docs change is being published as one Git-data commit. GitHub Actions on the exact resulting SHA is authoritative; no pass is claimed until that run completes successfully.

### Known risks / next highest-value tasks

1. Wire same-resolution expired-lease recovery end-to-end: reacquire ownership, instantiate the observation-only verifier, consume durable reconciliation, use this atomic transition for `ALREADY_APPLIED`, and never dispatch the successor action on that path.
2. Add an explicit durable `AMBIGUOUS` -> human-attention transition/audit path so unresolved effects cannot strand a run in an opaque state.
3. Define a proof-of-absence/idempotency contract before any production verifier may return `DEFINITELY_NOT_APPLIED`; only then add a one-shot lease-owned retry path.
4. Add redacted audit milestones for effect preparation, inspection, reconciliation decision, atomic reconstructed advancement, and ambiguity fallback.
5. Deliberately align the existing AWS SDK peer-version warning rather than suppressing it.
6. After crash recovery is reconciled end-to-end, continue outward through capture -> compile -> test -> publish -> schedule production hardening.
