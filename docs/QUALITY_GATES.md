# Quality Gates

This project is a production-oriented cloud automation system. Reliability failures can cause repeated actions, wrong-site interactions, credential exposure, or silent data loss. Changes are not complete merely because they compile.

## Non-negotiable release gates

Every coherent increment must satisfy the applicable gates below before it is treated as complete.

### 1. Architecture consistency
- Re-read `docs/END_GOAL.md` and `docs/ARCHITECTURE.md` before material changes.
- Preserve provider-neutral core boundaries.
- Do not place AWS/GCP-specific assumptions inside workflow IR, compiler, retry, verification, checkpoint, or domain contracts.
- Prefer explicit interfaces and dependency injection over hidden globals.

### 2. Correctness and invariants
- Define the state transition being changed.
- Reject impossible or invalid states rather than silently normalizing them.
- Validate workflow graph references, retry budgets, timeouts, schedules, and tenant ownership at boundaries.
- Never infer success from an attempted browser action; success requires an explicit verification condition.

### 3. Idempotency and concurrency
- Scheduled/event delivery must be safe under duplicate delivery.
- Side-effecting nodes need idempotency strategy or an explicit non-repeatable guard.
- Do not allow concurrent runs of the same automation unless the automation policy explicitly permits it.
- Persist run/checkpoint state before acknowledging work that may be retried.
- Human-resolution commands must be idempotent by stable resolution ID and pause boundary. Production claim stores must use an atomic conditional write or equivalent transaction; read-then-unconditional-write implementations are invalid.
- A duplicate of the already-accepted resolution may return `REPLAY`, while a different resolution ID for the same run/node boundary must return `CONFLICT` and must not start resume execution.
- `REPLAY` is never execution permission. Human resume browser/model execution may start only for a newly `ACCEPTED` claim unless a separate durable recovery policy explicitly grants safe execution ownership.
- Newly accepted human resume execution must acquire a durable execution lease before browser/model work starts. The lease must be scoped to tenant + user + run + paused node + resolution ID and owned by an opaque worker token.
- Production lease stores must atomically prevent overlapping owners. Expired ownership may be reacquired only by the same resolution ID; a competing resolution ID must remain a conflict.
- Completion is a durable tombstone. A completed human-resume boundary must not become executable again merely because a TTL elapsed.
- Worker crash recovery must not rely on claim replay or lease expiry alone. Node-level idempotency/effect verification must address the unknown-side-effect window before automatic recovery can be considered safe.

### 4. Failure handling
- Classify failures before retrying.
- Retries must be bounded and use backoff for transient failures.
- Repeated identical failure states must trip a retry budget and pause rather than loop forever.
- Authentication, quota, policy, human-decision, and destructive-action failures are not generic transient errors.
- Paused runs must retain enough checkpoint/evidence state for deterministic recovery.
- Explicit `HUMAN`-node resume must never infer control flow. Until a typed human branch-selection contract exists, resume requires exactly one declared successor and must reject ambiguous topology before mutating the persisted run out of `WAITING_FOR_HUMAN`.
- Database/network uncertainty during human-resolution claiming or execution-lease mutation must propagate as a failure; it must never be guessed to mean replay, conflict, acquisition, renewal, or completion.
- If resume execution fails after claim acceptance, do not reinterpret a later claim replay as permission to rerun side effects.
- If execution finishes after its durable lease expired or was lost, do not report durable success from the orchestration boundary; surface the ownership-loss failure for reconciliation.

### 5. Security and tenant isolation
- Never store raw external API keys in application metadata tables or logs.
- Never log cookies, auth headers, session tokens, full browser profiles, or secret-bearing DOM values.
- Every automation, browser profile, credential reference, artifact, and run must be scoped to an owning tenant/user.
- Browser executors must not accept arbitrary profile identifiers without ownership authorization.
- Human approval boundaries must exist for risky/destructive actions.
- Human-resolution claims and resume execution leases must be partitioned/scoped by tenant and user, and durable payload identity must be validated when read.
- Human-resume lease owner tokens are operational capability material: persist only where needed for compare-and-set ownership and never expose them to clients, user-visible histories, or logs.

### 6. Browser safety
- Deterministic Playwright/CDP interaction is preferred when a known validated strategy exists.
- Semantic/vision recovery is fallback behavior, not the default for every click.
- Recovery must preserve the node objective and allowed side effects.
- A changed UI must never broaden an action beyond its original intent.
- CAPTCHA, MFA, bot/security challenges, or explicit site restrictions must be surfaced to the human rather than bypassed.

### 7. Reasoning-provider safety
- Model calls must have explicit timeout and retry behavior.
- Invalid credentials and exhausted quota must not be retried indefinitely.
- Key rotation/failover must not be implemented as rate-limit or billing circumvention.
- Reasoning output used for side effects must be validated against workflow constraints before execution.

### 8. Persistence and recovery
- Critical run state must survive process/browser termination.
- Do not rely on in-memory state for anything required after retry, pause, restart, or human takeover.
- Version workflow definitions; a run must remain bound to the workflow version it started with unless an explicit migration/resume rule exists.
- Browser compute may terminate while waiting for a human; persistent browser/session state and checkpoint evidence must be saved first.
- Human-resolution acceptance must be durable before browser/model resume work starts so duplicate workers can be rejected before side effects.
- Human-resume execution ownership must be durable and conditionally acquired/renewed/completed; overlapping owners are invalid.
- Lease renewal must occur before expiry. Expired ownership cannot be completed as though it were still valid.
- Automatic recovery after lease expiry remains disabled until a durable effect-reconciliation strategy proves rerunning the successor is safe.

### 9. Observability
- Every run needs a stable run ID and correlation context.
- Record node attempts, failure class, retry count, verification result, timing, and checkpoint state without leaking secrets.
- User-facing run history must distinguish succeeded, retrying, paused, needs-auth, needs-credential, failed, and canceled states.
- Human-resolution audit events should distinguish claim accepted/replayed/conflicted, lease acquired/busy/completed/expired, and executor start/finish without logging lease owner tokens or sensitive browser data.

### 10. Tests and CI
- Add or update tests for every behavior changed.
- Include negative-path tests, not only happy paths.
- CI must run type checking and tests for every PR to `main` and direct push to `main`.
- A red CI run must be root-caused from logs; do not disable a failing check simply to make CI green.
- Never claim a test/check passed unless it was actually executed successfully.
- Durable idempotency adapters require contention tests, same-command replay tests, conflicting-command tests, tenant-isolation tests, and non-conditional failure propagation tests.
- Human resume orchestration tests must prove replay/conflict outcomes are non-executing, including concurrent duplicate delivery and executor-failure cases.
- Human-resume lease tests must prove single-owner acquisition, same-resolution reacquisition only after expiry, conflict isolation, renewal/completion owner checks, completed tombstones, tenant isolation, stale-expiry rejection, and propagation of non-conditional storage failures.

### 11. Dependency discipline
- Avoid dependencies when a small well-tested internal abstraction is sufficient.
- Check license compatibility before incorporating open source.
- Record incorporated significant open-source components where hackathon disclosure requires it.
- Keep runtime dependencies separated from development/test tooling.

### 12. Production/scaling review
For material changes, explicitly consider:
- cost per run,
- burst concurrency,
- queue/backpressure behavior,
- cloud-service quotas,
- browser session lifetime,
- multi-region/timezone assumptions,
- duplicate schedule delivery,
- stale authentication,
- model/provider outages,
- partial external side effects,
- user-visible recovery path.

## Definition of done

A change is done only when:
1. its architectural placement is understood,
2. invariants and failure modes are identified,
3. implementation is complete for the intended slice,
4. tests cover the new behavior and important failure paths,
5. available checks/CI are green,
6. no secrets or tenant boundaries were weakened,
7. `docs/PROGRESS.md` records exactly what was changed, validated, and still remains.

If a requirement cannot yet be validated because real cloud credentials are unavailable, the adapter must expose a stable contract and use a deterministic test double; the missing live validation must be documented as an explicit blocker rather than assumed to work.
