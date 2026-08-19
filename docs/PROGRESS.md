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
- Lease-owned atomic `ALREADY_APPLIED` run+checkpoint transition with AWS DynamoDB transaction semantics.
- Provider-neutral crash-recovery admission boundary for replayed human resolutions. A replay may reacquire expired same-resolution ownership only after a matching durable first-successor effect exists, and the resulting ownership is reconciliation-only rather than action-execution permission.
- Provider-neutral crash-reconciliation worker plus AWS observation-only runtime factory. Replacement ownership can now restore the immutable workflow/browser profile and reconcile the prepared first-successor effect without exposing `BrowserExecutor` or reasoning capabilities.

## Recent authoritative validation

- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with durable redacted human-resume audit history.
- CI #116 passed on `b09a32fda4bfe0b2cb7957395ff69e4f94310545` with durable effect reconciliation authority.
- CI #118 passed on `f22d0e1402d5ba3659d6ad3c2362e70c5f3e768f` with the provider-neutral read-only reconciliation boundary.
- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only reconciliation verifier.
- CI #120 passed on `47b7d4805d6a10c7f405bab73d386d94bc14b15b` with provider-neutral `ALREADY_APPLIED` checkpoint reconstruction.
- CI #121 passed on `72e8168dbb42551954c6dd8ea7ccfe30b908d593` with the lease-owned atomic `ALREADY_APPLIED` recovery transition.
- CI #122 on `64b112031b008e91ad3c6ac6a5a2ae985cfcd6bb` passed install and `pnpm check` but failed one new worker-test assertion. Log inspection showed the production safety invariant held: the conflicting durable effect identity suppressed browser dispatch; `WorkflowExecutionEngine` intentionally converted the boundary failure into a durable `WAITING_FOR_HUMAN` checkpoint instead of propagating the exception. The corrective test asserts that actual fail-closed state; no production behavior or quality gate was weakened.
- CI #123 passed on `0352ad8c27570a0f2930807c12aaf0fa24c1edeb`, confirming the corrective human-resume conflict regression.
- CI #124 passed on `2b3ca598355efd61b43832492c727f7125c19f3d`, confirming crash-recovery admission for replayed resolutions.
- The execution container has no authenticated local checkout path and cannot resolve `github.com`, so no local install/check/test pass is claimed. GitHub Actions on the exact published head remains authoritative.

## 2026-08-19 — Add heartbeat-fenced observation-only crash reconciliation worker

### Completed in this slice

- Added provider-neutral `HumanResumeRecoveryWorker` as the consumer of `RECONCILIATION_OWNERSHIP_ACQUIRED` admission. It accepts only replayed same-resolution recovery ownership; it is not compatible with the normal newly-accepted `HumanResumeWorker` execution request.
- Added a separate `HumanResumeReconciliationRuntimeFactory` / `HumanResumeReconciliationRuntime` type whose capability surface is only `HumanResumeEffectVerifier` + cleanup. `BrowserExecutor`, semantic action execution, and reasoning-provider methods are absent by construction.
- Recovery revalidates the durable replayed claim, run, checkpoint, effect identity, active lease, tenant/user boundary, immutable workflow version, explicit HUMAN node, and exact first successor before browser startup.
- Disabled automations are rejected before browser startup. The authorized browser profile is restored into a new ephemeral session, but observation-only recovery deliberately never saves profile changes back.
- Replacement execution ownership is renewed before browser startup and heartbeats throughout recovery. Session creation, observation-runtime creation, effect preparation replay, read-only inspection, and reconciliation decision persistence are fenced by the same heartbeat.
- Existing durable reconciliation decisions remain authoritative and suppress reinspection. `ALREADY_APPLIED` and `AMBIGUOUS` are returned as reconciliation results only; this slice does not advance the run or authorize action replay.
- Added AWS `AgentCorePlaywrightHumanResumeReconciliationRuntimeFactory`. It establishes CDP using the existing Playwright dependency, exposes only the existing observation verifier, classifies connection uncertainty with fixed sanitized failures, and closes a partially-created browser on setup failure.
- Added regression coverage for positive `ALREADY_APPLIED` reconciliation, `AMBIGUOUS` preservation, prior-decision replay without inspection, disabled-automation suppression, immutable-successor drift rejection, lease-renewal failure before browser startup, observation-only AWS runtime shape, connection settings, setup cleanup, uncertainty classification, and invalid timeout configuration.
- No dependency or third-party source was added. Existing `playwright-core` is reused; provider-neutral core remains free of AWS/GCP types.

### Invariants / failure semantics

- Recovery ownership is observation/reconciliation authority only. No code path in `HumanResumeRecoveryWorker` can dispatch deterministic or semantic browser actions because its runtime interface does not contain those methods.
- A recovery worker must still own a live same-resolution lease before every ownership-sensitive operation. Any rejected or uncertain renewal permanently fences that worker through `HumanResumeLeaseHeartbeat`.
- Durable effect identity must match the immutable HUMAN successor. Workflow drift or corrupted effect identity fails before browser startup.
- Storage uncertainty while replaying effect preparation or persisting a reconciliation decision propagates. It is never translated into `ALREADY_APPLIED`, `DEFINITELY_NOT_APPLIED`, or `AMBIGUOUS`.
- A prior durable decision is authoritative and suppresses runtime inspection even though the browser session may already have been reconstructed. This preserves first-writer-wins reconciliation authority.
- Observation-only recovery does not persist browser-profile changes. Reads, page settling, or accidental browser-local mutations during inspection therefore cannot overwrite the authoritative saved profile.
- This worker deliberately does not complete the replacement lease. It returns the latest owned lease so the next synchronous recovery stage can consume it; if no continuation stage runs, ownership naturally expires. Completing it here would prevent the existing atomic `ALREADY_APPLIED` transition from using the same ownership proof.

### Concurrency / idempotency / scaling review

- Admission plus the existing conditional lease store remains the single-owner serialization boundary. Concurrent replay deliveries cannot create overlapping recovery workers.
- Reconciliation persistence remains first-writer-wins. Concurrent observation is still safe because the runtime has no action capability, though duplicate browser/S3 inspection cost remains possible.
- Each admitted recovery can add one browser session, one CDP connection, heartbeat DynamoDB writes, and at most one metadata evidence write/decision persistence sequence. No model call, action execution, new queue, or new cloud service is introduced.
- The heartbeat interval remains constrained to a positive safe integer strictly below the lease TTL; current defaults preserve the roughly one-third TTL policy.

### Security / tenant isolation / secret handling

- Tenant/user scope is revalidated against claim, run, effect, and lease before any browser session is created.
- Browser profile selection remains server-owned through the authorized automation record; the recovery request cannot supply an arbitrary profile reference.
- Session connection material remains inside the trusted AWS runtime factory and is not persisted by the recovery worker.
- Worker owner tokens remain internal lease capability material. Cleanup warnings are fixed strings and do not contain provider errors or connection material.
- AWS connection errors expose fixed classified messages; provider error text remains only in the internal exception cause.

### User-visible recovery impact

- A replacement worker can now safely answer the first production recovery question after a crash: did the prepared first-successor effect already happen, or is the state ambiguous? It can do so without risking a second website action.
- `ALREADY_APPLIED` still does not automatically continue the workflow in this slice. `AMBIGUOUS` still does not yet have a dedicated durable transition/UI command, so automatic crash recovery remains incomplete and fail-closed.
- `DEFINITELY_NOT_APPLIED` remains non-production action authority because there is still no explicit positive proof-of-absence/idempotency contract.

### Validation status for this slice

- Incoming head `2b3ca598355efd61b43832492c727f7125c19f3d` is confirmed green via GitHub Actions CI #124.
- The implementation, tests, AWS export, and this progress update are being published together in one Git-data commit. GitHub Actions on the exact resulting SHA is authoritative; no pass is claimed until that run completes successfully.
- No local install/check/test pass is claimed because the execution container cannot resolve `github.com`.

### Known risks / next highest-value tasks

1. Consume `ALREADY_APPLIED` immediately under the returned live recovery lease using the existing atomic run+checkpoint transition, then define crash-safe continuation after that reconstructed advancement so a `RUNNING` run cannot become stranded.
2. Add a durable `AMBIGUOUS` -> human-attention transition and explicit owner reconciliation command semantics that do not conflict with the immutable original resolution claim.
3. Define an explicit proof-of-absence/idempotency contract before any production path may turn `DEFINITELY_NOT_APPLIED` into action execution permission.
4. Add redacted audit milestones for recovery admission, observation-runtime start, inspection, reconciliation decision, reconstructed advancement, and ambiguity fallback.
5. Deliberately align the existing AWS SDK peer-version warning rather than suppressing it.
6. After crash recovery is reconciled end-to-end, continue outward through capture -> compile -> test -> publish -> schedule production hardening.

## 2026-08-19 — Crash-recovery admission for replayed human resolutions

- Added `HumanResumeRecoveryAdmission` as the only bridge from claim `REPLAY` toward crash recovery.
- Fresh `ACCEPTED` claims remain on the normal healthy resume path; conflicts remain non-executing.
- Recovery ownership is allowed only when a durable first-successor effect exists for the exact tenant/user/run/HUMAN-node/resolution boundary.
- A live worker remains `BUSY`; only expired same-resolution ownership can be reacquired. Missing, corrupt, or cross-resolution effect state fails closed.
- The successful capability is explicitly `RECONCILIATION_OWNERSHIP_ACQUIRED`, not execution permission.
- Regression coverage proves expired same-resolution reacquisition, live-owner exclusion, no-effect suppression, cross-resolution rejection, and fresh/conflicting claim exclusion.
- Validated by CI #124 on `2b3ca598355efd61b43832492c727f7125c19f3d`.

## 2026-08-19 — Prepare reconciliation identity before resumed side effects

- `HumanResumeWorker` now durably prepares one exact first-successor effect identity immediately before the first side-effecting resumed action can dispatch.
- The identity is scoped to tenant/user/run/HUMAN-node/successor/resolution/effect and reused across deterministic -> semantic fallback.
- Preparation conflict, an already-decided effect, or storage uncertainty suppresses action dispatch and fails closed.
- Non-side-effecting HUMAN successors avoid unnecessary effect records.
- CI #122 exposed one stale test expectation; log inspection proved zero action dispatch and durable `WAITING_FOR_HUMAN`. The corrective assertion passed CI #123 on `0352ad8c27570a0f2930807c12aaf0fa24c1edeb`.

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

Exact historical implementations and CI evidence remain available in git history; this log intentionally keeps the active production invariants and nearest recovery work prominent for subsequent runs.
