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
- Pure `planAlreadyAppliedHumanResumeRecovery` checkpoint reconstruction without replaying the external action.
- Lease-owned atomic `ALREADY_APPLIED` recovery transition for run + checkpoint.
- Crash-recovery admission for replayed same-resolution human commands and a heartbeat-fenced observation-only recovery worker.

## Recent authoritative validation

- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only reconciliation verifier.
- CI #120 passed on `47b7d4805d6a10c7f405bab73d386d94bc14b15b` with provider-neutral `ALREADY_APPLIED` checkpoint reconstruction.
- CI #121 passed on `72e8168dbb42551954c6dd8ea7ccfe30b908d593` with the lease-owned atomic recovery transition.
- CI #122 failed one new test assertion; log inspection showed production behavior correctly failed closed. The test-only correction passed CI #123 on `0352ad8c27570a0f2930807c12aaf0fa24c1edeb`.
- CI #124 passed on `2b3ca598355efd61b43832492c727f7125c19f3d` with replay crash-recovery admission.
- CI #125 passed on `6b0df3506d84bb1c5623c2c45cd0d3f084405b1e` with heartbeat-fenced observation-only crash reconciliation.
- No local install/check/test pass is claimed; GitHub Actions on the exact published head remains authoritative.

## 2026-08-19 — Make reconstructed advancement crash-safe with an atomic continuation record

### Completed in this slice

- Tightened `HumanResumeAlreadyAppliedTransitionStore`: a successful `ALREADY_APPLIED` recovery commit now requires one durable `HumanResumeRecoveryContinuation` to be persisted atomically with the reconstructed `RUNNING` run and checkpoint.
- The continuation is provider-neutral and contains only bounded ownership/control-flow identity: tenant, user, run, automation, immutable workflow version, paused HUMAN node, resolution/effect IDs, reconstructed next node, `PENDING` state, and creation time.
- Added `buildAlreadyAppliedRecoveryContinuation(...)` so every adapter derives the handoff from the same validated recovery boundary rather than inventing provider-specific continuation payloads.
- Added timestamp validation preventing the transition commit from preceding the reconstructed checkpoint timestamp.
- AWS DynamoDB recovery transition now writes four transactional components under the same live-lease condition: lease condition check, run replacement, checkpoint replacement, and a create-only continuation/outbox record.
- Duplicate classification now performs strongly consistent reads of run, checkpoint, and continuation and returns `REPLAY` only if all three carry the same transition identity and exact expected state. Missing, corrupted, or competing continuation state returns `CONFLICT`.
- Added regression coverage for atomic continuation persistence, exact three-record replay, competing continuation conflict, tenant isolation, lease loss, timestamp ordering, and propagation of DynamoDB transport/non-conditional uncertainty.
- No dependency, third-party source, AWS/GCP type in core, secret, browser content, raw exception, or lease owner token was added to the continuation payload.

### Invariants / failure semantics

- Reconstructed advancement must never durably leave a run `RUNNING` without also leaving a durable fact that continuation work is pending.
- The continuation is a handoff record, not external-action authority. It cannot authorize replay of the reconciled successor and does not weaken the rule that `DEFINITELY_NOT_APPLIED` requires a future explicit proof-of-absence/idempotency contract.
- The continuation is created only while the exact same-resolution recovery lease is live and only in the same transaction that advances run/checkpoint.
- A second continuation for the same run/HUMAN boundary cannot overwrite the first. Contention is classified only after strongly consistent reads.
- DynamoDB throttling, transport uncertainty, permissions failures, or non-conditional transaction cancellation propagate. They are never guessed to mean APPLIED/REPLAY/CONFLICT.

### Concurrency / idempotency / scaling review

- The existing execution lease remains the single-owner gate. The new record adds no competing ownership primitive.
- The transaction adds one DynamoDB write item to this rare crash-recovery path. Normal healthy execution cost is unchanged.
- Replay classification adds one strongly consistent read only after a conditional transaction loses; normal successful recovery performs no follow-up read.
- The continuation key is scoped by tenant/user partition plus run/HUMAN boundary, so concurrent tenants and unrelated runs remain isolated.

### Security / tenant isolation / observability

- Continuation records contain no cookies, profile data, DOM/text evidence, API keys, raw provider errors, model prompts, or worker owner tokens.
- Tenant/user ownership is derived from the already-validated recovery boundary and persisted with immutable run/workflow identity.
- This slice does not yet emit a new user-visible event; the record is execution-plane persistence authority for the next dispatcher/consumer slice.

### User-visible recovery impact

- The platform now has a durable crash-safe handoff after an `ALREADY_APPLIED` reconstruction. If a worker dies immediately after the atomic transition, durable state still records that continuation is pending instead of relying on the dead process to remember to continue.
- Automatic end-to-end continuation is still deliberately disabled until a consumer can idempotently claim this pending record and resume from the reconstructed checkpoint.
- `AMBIGUOUS` remains human attention only. `DEFINITELY_NOT_APPLIED` remains non-executable in production.

### Validation status for this slice

- Incoming head `6b0df3506d84bb1c5623c2c45cd0d3f084405b1e` is confirmed green via CI #125.
- This implementation, tests, and progress update are published as one Git-data commit. GitHub Actions on the exact resulting SHA is authoritative; no green result is claimed until that run completes successfully.

### Known risks / next highest-value tasks

1. Add a provider-neutral continuation repository/claim contract and AWS conditional consumer semantics (`PENDING` -> owned/consumed tombstone) so duplicate dispatch cannot resume the reconstructed checkpoint twice.
2. Wire the recovery worker so `ALREADY_APPLIED` plans reconstruction and performs this atomic run+checkpoint+continuation commit under the still-live heartbeat-fenced replacement lease.
3. Add a durable `AMBIGUOUS` -> explicit human-attention transition with owner command semantics that do not conflict with the immutable original resolution claim.
4. Define positive proof-of-absence/idempotency before any production path may execute from `DEFINITELY_NOT_APPLIED`.
5. Add redacted audit milestones for recovery admission, observation runtime, reconciliation decision, reconstructed advancement, continuation claim/finish, and ambiguity fallback.
6. Deliberately align the existing AWS SDK peer-version warning rather than suppressing it.
7. After crash recovery is closed end-to-end, continue outward through capture -> compile -> test -> publish -> schedule hardening.

## Earlier recovery milestones retained as architectural guarantees

- Explicit HUMAN pause/resume and immutable workflow pinning.
- Atomic human-resolution claims and durable AWS conditional claim store.
- Resume orchestration where only newly accepted claims execute.
- Durable human-resume lease with completed tombstones and same-resolution-only reacquisition semantics.
- Production human-resume worker with browser/profile reconstruction.
- Continuous heartbeat fencing around long browser/model/verification/checkpoint/profile operations.
- Redacted append-only human-resume audit history.
- Durable first-successor effect reconciliation authority and AWS conditional persistence.
- Read-only reconciliation coordinator and AWS observation-only Playwright verifier.
- Pure `ALREADY_APPLIED` checkpoint reconstruction planning.
- Lease-owned atomic DynamoDB run+checkpoint recovery transition.
- Crash-recovery admission and observation-only recovery runtime.
