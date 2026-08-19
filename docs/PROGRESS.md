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

## Recent authoritative validation

- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with durable redacted human-resume audit history.
- CI #116 passed on `b09a32fda4bfe0b2cb7957395ff69e4f94310545` with durable effect reconciliation authority.
- CI #118 passed on `f22d0e1402d5ba3659d6ad3c2362e70c5f3e768f` with the provider-neutral read-only reconciliation boundary.
- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only reconciliation verifier.
- CI #120 passed on `47b7d4805d6a10c7f405bab73d386d94bc14b15b` with provider-neutral `ALREADY_APPLIED` checkpoint reconstruction.
- CI #121 passed on `72e8168dbb42551954c6dd8ea7ccfe30b908d593` with the lease-owned atomic `ALREADY_APPLIED` recovery transition. This is the validated incoming head for the current slice.
- CI #122 on `64b112031b008e91ad3c6ac6a5a2ae985cfcd6bb` passed install and `pnpm check` but failed one new worker-test assertion. Log inspection showed the production safety invariant held: the conflicting durable effect identity suppressed browser dispatch; `WorkflowExecutionEngine` intentionally converted the boundary failure into a durable `WAITING_FOR_HUMAN` checkpoint instead of propagating the exception. The corrective test now asserts that actual fail-closed state. No production behavior or quality gate was weakened.
- The execution container has no authenticated GitHub CLI/local checkout path, so no local install/check/test pass is claimed. GitHub Actions on the exact published head remains authoritative.

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
- One corrective test/docs commit is being published after root-cause analysis. GitHub Actions on the exact corrective SHA is authoritative; no green pass is claimed until that run completes successfully.

### Known risks / next highest-value tasks

1. Wire same-resolution expired-lease recovery end-to-end: replayed claims may reacquire only same-resolution expired ownership and must enter observation/reconciliation, never the normal action executor.
2. For `ALREADY_APPLIED`, solve durable continuation semantics after the atomic run+checkpoint reconstruction so a crash between reconstructed advancement and continuation cannot strand a `RUNNING` run.
3. Add an explicit durable `AMBIGUOUS` -> human-attention command/transition that also defines how the owner can submit a new authoritative reconciliation choice without conflicting with the immutable original resolution claim.
4. Define an explicit proof-of-absence/idempotency contract before any production path may act on `DEFINITELY_NOT_APPLIED`; until then automatic external-effect retry remains disabled.
5. Add redacted audit milestones for effect preparation, inspection, reconciliation decision, reconstructed advancement, and ambiguity fallback.
6. Deliberately align the existing AWS SDK peer-version warning rather than suppressing it.
7. After crash recovery is reconciled end-to-end, continue outward through capture -> compile -> test -> publish -> schedule production hardening.
