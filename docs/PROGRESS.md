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
- Provider-neutral crash-recovery admission boundary for replayed human resolutions. A replay may reacquire expired same-resolution ownership only after a matching durable first-successor effect exists, and the resulting ownership is explicitly reconciliation-only rather than action-execution permission.

## Recent authoritative validation

- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with durable redacted human-resume audit history.
- CI #116 passed on `b09a32fda4bfe0b2cb7957395ff69e4f94310545` with durable effect reconciliation authority.
- CI #118 passed on `f22d0e1402d5ba3659d6ad3c2362e70c5f3e768f` with the provider-neutral read-only reconciliation boundary.
- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only reconciliation verifier.
- CI #120 passed on `47b7d4805d6a10c7f405bab73d386d94bc14b15b` with provider-neutral `ALREADY_APPLIED` checkpoint reconstruction.
- CI #121 passed on `72e8168dbb42551954c6dd8ea7ccfe30b908d593` with the lease-owned atomic `ALREADY_APPLIED` recovery transition.
- CI #122 on `64b112031b008e91ad3c6ac6a5a2ae985cfcd6bb` passed install and `pnpm check` but failed one new worker-test assertion. Log inspection showed the production safety invariant held: the conflicting durable effect identity suppressed browser dispatch; `WorkflowExecutionEngine` intentionally converted the boundary failure into a durable `WAITING_FOR_HUMAN` checkpoint instead of propagating the exception. The corrective test asserts that actual fail-closed state; no production behavior or quality gate was weakened.
- CI #123 passed on `0352ad8c27570a0f2930807c12aaf0fa24c1edeb`, confirming the corrective human-resume conflict regression on the incoming head.
- The execution container has no authenticated local checkout path, so no local install/check/test pass is claimed. GitHub Actions on the exact published head remains authoritative.

## 2026-08-19 — Add explicit crash-recovery admission for replayed human resolutions

### Completed in this slice

- Added provider-neutral `HumanResumeRecoveryAdmission` as the only intended bridge from a duplicate `REPLAY` claim toward future crash recovery.
- Fresh `ACCEPTED` claims remain routed to the normal healthy resume path; conflicting resolution claims remain non-recoverable.
- A replay is not allowed to acquire replacement ownership unless a durable first-successor effect record already exists for the exact tenant/user/run/HUMAN-node/resolution boundary.
- Embedded effect ownership/resolution identity and durable state shape are validated before lease acquisition, so corrupted or cross-resolution records cannot become recovery authority.
- Replacement ownership uses the existing conditional execution-lease store; a live owner remains `BUSY`, a completed tombstone remains completed, and only an expired same-resolution lease can be reacquired.
- The successful result is deliberately named `RECONCILIATION_OWNERSHIP_ACQUIRED`. It is not compatible with `HumanResumeWorker` and does not grant permission to execute or retry the external action.
- Added regression coverage for expired same-resolution reacquisition, live-owner exclusion, no-effect suppression, cross-resolution effect rejection before lease acquisition, and exclusion of fresh/conflicting claims from the recovery path.
- Exported the new provider-neutral boundary from `@automation/core`. No dependency, AWS/GCP-specific type, secret-bearing payload, browser content, or arbitrary user metadata was added.

### Invariants / failure semantics

- Claim `REPLAY` remains non-execution permission. This slice creates a narrower separate recovery policy whose authority is limited to observation/reconciliation work.
- Absence of a durable effect record does not become implicit retry permission, even though healthy execution now prepares before dispatch. Recovery remains fail-closed until an explicit continuation policy consumes that state.
- Durable effect identity must exactly match the replayed command before replacement lease acquisition. Storage uncertainty from effect lookup or lease mutation propagates.
- A `DECIDED` record is still reconciliation authority only; even `DEFINITELY_NOT_APPLIED` does not become action permission through this admission boundary.

### Concurrency / idempotency / scaling review

- The existing lease store remains the serialization authority, so concurrent recovery deliveries cannot create overlapping replacement owners.
- Effect lookup happens before lease acquisition, avoiding a replacement lease/write when no crash-reconciliation identity exists.
- Recovery admission adds one strongly scoped durable effect read and, only when eligible, one conditional lease acquisition. It does not start a browser, model, queue, schedule, or new cloud service.

### Security / tenant isolation

- Scope, run, paused node, and resolution identity are checked against the durable effect before any lease can be reacquired.
- Worker owner tokens remain internal lease capability material and are not surfaced in the admission result beyond the existing internal lease object passed to trusted execution-plane code.
- No browser/profile/DOM data or raw exception text is persisted or logged by the new boundary.

### User-visible recovery impact

- A crashed healthy resume can now be distinguished from an ordinary duplicate command in a way that is safe to hand to observation-only reconciliation in the next slice.
- A still-live original worker is not preempted. Missing/corrupt/conflicting reconciliation state remains safely non-executing and can continue to require human attention.
- Automatic external-effect replay is still disabled.

### Validation status for this slice

- Incoming head `0352ad8c27570a0f2930807c12aaf0fa24c1edeb` is confirmed green via GitHub Actions CI #123.
- This coherent core/tests/docs increment is being published as one Git-data commit. GitHub Actions on the exact resulting SHA is authoritative; no pass is claimed until that run completes successfully.

### Known risks / next highest-value tasks

1. Wire `RECONCILIATION_OWNERSHIP_ACQUIRED` into an ownership-heartbeated observation-only recovery worker that restores the immutable workflow/profile and invokes `HumanResumeEffectReconciler` without exposing action-capable browser methods.
2. For `ALREADY_APPLIED`, solve durable continuation semantics after the atomic run+checkpoint reconstruction so a crash between reconstructed advancement and continuation cannot strand a `RUNNING` run.
3. Add an explicit durable `AMBIGUOUS` -> human-attention command/transition that defines how the owner can submit a new authoritative reconciliation choice without conflicting with the immutable original resolution claim.
4. Define an explicit proof-of-absence/idempotency contract before any production path may act on `DEFINITELY_NOT_APPLIED`; until then automatic external-effect retry remains disabled.
5. Add redacted audit milestones for effect preparation, recovery admission, inspection, reconciliation decision, reconstructed advancement, and ambiguity fallback.
6. Deliberately align the existing AWS SDK peer-version warning rather than suppressing it.
7. After crash recovery is reconciled end-to-end, continue outward through capture -> compile -> test -> publish -> schedule production hardening.

## 2026-08-19 — Prepare reconciliation identity before resumed side effects

### Completed in this slice

- Wired the existing provider-neutral `HumanResumeEffectReconciliationStore` into `HumanResumeWorker` as a required production dependency.
- Added a required effect-ID generator. The generated ID is validated for non-empty bounded input and is converted into one exact `HumanResumeEffectIdentity` scoped to tenant, user, run, paused HUMAN node, first successor, and accepted resolution.
- The worker now resolves and validates the explicit HUMAN node's sole declared successor from the immutable workflow before browser execution begins.
- Immediately before the first resumed successor can dispatch a side-effecting deterministic or semantic browser action, the worker lease-fences a durable `effects.prepare(...)` operation.
- The same prepared identity is reused across deterministic -> semantic fallback for that same successor. The action is not allowed to start if durable preparation conflicts, has already been decided, or fails/returns uncertain storage state.
- Non-side-effecting HUMAN successors do not create unnecessary effect records; their execution remains governed by the existing checkpoint/heartbeat path.
- Added regression coverage proving preparation happens before browser dispatch and that a conflicting durable identity suppresses the website action entirely while leaving the run durably recoverable through human attention.
- No new dependency, AWS/GCP-specific type, secret-bearing payload, browser content, or user-provided arbitrary metadata was introduced.

### Invariants / failure semantics

- A resumed external side effect must never be the first durable fact in the crash window. Its reconciliation identity is persisted first while the same execution lease is demonstrably owned.
- Effect preparation is execution authority, so storage conflict/uncertainty fails closed before the browser action. It is not converted into a retry/replay guess. If the execution engine handles that boundary failure under the node's `HUMAN` escalation policy, the durable result is a `WAITING_FOR_HUMAN` checkpoint with no browser action dispatched.
- The effect record contains only bounded identity metadata already defined by the provider-neutral reconciliation contract. It does not contain cookies, DOM content, credentials, raw exceptions, profile data, or lease owner tokens.
- A durable record that is already `DECIDED` cannot be silently reused as healthy execution permission; healthy execution is suppressed rather than risking action replay after prior reconciliation.
- The existing heartbeat still fences the subsequent action independently. Preparing an identity does not grant action permission if lease ownership is lost before dispatch.

### Concurrency / idempotency / scaling review

- Healthy human resume still has one lease owner. If deterministic execution falls back to semantic execution for the same successor, one in-memory identity is reused and the durable store sees at most idempotent same-identity preparation.
- A replacement/competing identity cannot overwrite the prepared record because the production AWS store already uses conditional persistence.
- This adds at most one durable reconciliation write to a healthy human resume that begins with a side-effecting successor. Browser/model cost is unchanged.
- No additional queue, session, model invocation, table, or schedule is added.

### Security / tenant isolation

- Effect identity is derived from the already-authorized scope/run/resolution boundary and immutable workflow successor; callers cannot redirect preparation to another tenant, run, or arbitrary node.
- Effect IDs are opaque bounded operational identifiers. They must not carry secrets or browser state; the worker does not log them.

### User-visible recovery impact

- This closes the most dangerous prerequisite gap for future same-resolution crash recovery: if the first resumed successor reaches the website, a durable reconciliation identity necessarily existed before dispatch.
- A preparation conflict/uncertain preparation never becomes a website action; the current node escalation can durably return the run to human attention.
- Automatic crash replay remains disabled. The current worker still executes only newly accepted claims, and a later claim replay is not execution permission.

### Validation status for this slice

- Incoming head `72e8168dbb42551954c6dd8ea7ccfe30b908d593` is confirmed green via GitHub Actions CI #121.
- Initial slice commit `64b112031b008e91ad3c6ac6a5a2ae985cfcd6bb`: install and `pnpm check` passed; CI #122 failed only because the new conflict test expected an uncaught rejection instead of the engine's designed `WAITING_FOR_HUMAN` result. Logs confirmed zero browser dispatch and 88/89 core tests passed.
- Corrective head `0352ad8c27570a0f2930807c12aaf0fa24c1edeb` passed GitHub Actions CI #123.

### Known risks / next highest-value tasks

Superseded by the newer recovery-admission section above.
