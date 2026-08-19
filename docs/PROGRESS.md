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
- Durable redacted human-resume audit history records lifecycle identity without storing browser state, secrets, raw errors, or lease owner tokens.
- Durable first-successor effect reconciliation prepares one stable effect identity and persists one immutable tri-state decision using provider-neutral contracts plus AWS conditional DynamoDB storage.

## Validation history before this slice

- CI #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims.
- CI #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- CI #111 passed on `b13d815bf087da799f441991378bb715fcd41c4a` with durable human-resume execution leases and orchestration lease gating.
- CI #112 passed on `2c5cde839a3aebe229942fa5ee7dba5e4e16ea7c` with production human-resume runtime reconstruction.
- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with the durable redacted human-resume audit trail.
- CI #116 passed on `b09a32fda4bfe0b2cb7957395ff69e4f94310545` with durable first-successor effect reconciliation authority.
- CI #118 passed on `f22d0e1402d5ba3659d6ad3c2362e70c5f3e768f` with the provider-neutral read-only reconciliation verifier boundary.
- CI #119 passed on `11be1b0804a70174fa0279233b359de9ad21ac9d` with the AWS observation-only Playwright reconciliation verifier. This was the validated head before the current slice.
- The execution container still cannot resolve `github.com`, so no local install/check/test pass is claimed. GitHub Actions is authoritative.

## 2026-08-19 — Read-only human-resume reconciliation verifier boundary

### Completed in this slice

- Added provider-neutral `HumanResumeEffectVerifier`, `HumanResumeEffectInspectionContext`, and `HumanResumeEffectInspectionResult` contracts.
- Added `HumanResumeEffectReconciler`, which validates that reconciliation targets the exact prepared successor, requires a real side-effecting executable node with an explicit verification contract, durably prepares the stable effect identity before inspection, invokes only the read-only verifier boundary, and persists the verifier's tri-state decision through the existing immutable reconciliation store.
- Existing durable decisions are authoritative: an exact-identity replay with state `DECIDED` returns the prior decision without invoking the verifier again.
- Competing effect identities return `CONFLICT` before verifier work starts.
- Verifier exceptions/transport uncertainty propagate and leave the durable effect in `PREPARED`; no guessed decision is written.
- Runtime decision values are validated at the coordinator boundary even though TypeScript exposes a closed union, preventing malformed adapter/runtime values from silently entering execution authority.
- Added provider-neutral tests covering prepare-before-inspect behavior, durable-decision replay without reinspection, conflict suppression, verifier-failure preservation of `PREPARED`, invalid/mismatched successor rejection, ambiguity preservation, and concurrent read-only inspection where the first durable decision remains authoritative.
- Exported the new reconciliation boundary from `@automation/core`.
- Updated architecture and quality gates in the same atomic change. No new dependency or third-party source was added.

### Invariants and failure-mode review

- Reconciliation inspection is observation-only. `HumanResumeEffectVerifier` is intentionally separate from `BrowserExecutor`; the verifier contract exposes no method capable of executing the workflow successor.
- `DEFINITELY_NOT_APPLIED` is a proof obligation. A production verifier that cannot establish absence must return `AMBIGUOUS`, never infer safe retry from a failed/negative ordinary verification check.
- The stable effect identity is durably prepared before browser/model inspection so a replacement worker cannot silently inspect a different intended effect for the same pause boundary.
- A previously persisted decision is the source of truth. Reinspection cannot overturn it.
- Verifier failure, timeout, model uncertainty, browser read failure, or storage uncertainty does not widen retry permission. The effect remains undecided or the error propagates.
- This slice still does not reacquire expired execution leases or automatically advance/retry successors. It establishes the safe classification boundary first.

### Concurrency / idempotency review

- Identity contention is resolved before verifier work through the existing atomic prepare operation.
- Multiple workers may legitimately perform read-only inspection concurrently after observing the same `PREPARED` effect. The existing conditional decision write remains the authority: one decision becomes `DECIDED`; a competing decision receives `CONFLICT`; an identical later decision is `REPLAY`.
- Duplicate inspection can add browser/model cost, but cannot duplicate the external workflow action because the verifier interface is observation-only. If this cost becomes material, a separate reconciliation-inspection lease can be added without changing decision semantics.
- No read-then-unconditional-write path was introduced.

### Security / tenancy review

- Inspection context is derived from the already-scoped durable identity and contains tenant/user/run/HUMAN-node/resolution/effect identity plus the immutable successor node and verification contract.
- The execution-authority record remains unchanged and continues to exclude cookies, DOM/browser payloads, credentials, raw errors, model prompts, and lease owner tokens.
- Inspection evidence is returned only as artifact references; raw browser evidence remains in the protected evidence system.
- The verifier boundary must be implemented with observation-only capabilities. Action-capable browser executors must not be passed through this interface in production adapters.

### Timeout, retry, observability, cost, and scaling review

- The coordinator adds no retry loop. Verifier timeout/retry policy belongs to the concrete read-only verifier implementation and must remain bounded.
- A verifier failure leaves the effect `PREPARED`, allowing a later controlled reconciliation attempt without granting external-action permission.
- Existing durable decisions skip verifier work, avoiding repeated browser/model inspection on ordinary duplicate delivery.
- Concurrent workers can duplicate read-only inspection cost before a decision commits. This is accepted for correctness in the current slice; there is still only one durable decision and zero action execution through the verifier interface.
- No new storage table or dependency was added.

### User-visible failure recovery

- `ALREADY_APPLIED`: eventual recovery should reconstruct post-effect state/checkpoint and advance without replaying the action.
- `DEFINITELY_NOT_APPLIED`: eventual recovery may retry only after safe same-resolution lease reacquisition and stable effect identity confirmation.
- `AMBIGUOUS`: return/keep the run in human attention rather than risking a duplicate effect.
- Verifier/storage failure should surface as a platform reconciliation failure with no claim that the action is safe to repeat.

### Known risks / unresolved questions

- Automatic same-resolution lease reacquisition and crash recovery remain disabled.
- `ALREADY_APPLIED` still needs checkpoint/output reconstruction so the engine can advance without executing the successor.
- `DEFINITELY_NOT_APPLIED` still needs one safe, lease-owned retry path that consumes the durable decision exactly once.
- `AMBIGUOUS` still needs explicit transition/audit/UI wiring back to human attention.
- Stable effect-ID derivation is still not wired to the first resumed successor at runtime.
- Effect preparation/reconciliation audit events remain incomplete.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains.
- The AWS SDK peer-version warning still needs deliberate package alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic tests are the current evidence.

## 2026-08-19 — AWS observation-only Playwright reconciliation adapter

### Completed in this slice

- Added `AgentCorePlaywrightHumanResumeEffectVerifier`, the first production AWS/Playwright implementation of `HumanResumeEffectVerifier`.
- The adapter accepts only a deliberately narrowed observation surface (`url`, `title`, text visibility, DOM visibility). Its type does not expose navigation, click, fill/type, keyboard, script evaluation, upload/download, or semantic action methods.
- DOM, TEXT, and URL positive observations return `ALREADY_APPLIED`.
- Negative observations return `AMBIGUOUS`; the adapter deliberately never converts an ordinary failed positive verification into `DEFINITELY_NOT_APPLIED` because the current `VerificationSpec` schema has no explicit proof-of-absence contract.
- MODEL and CUSTOM reconciliation remain `NOT_CONFIGURED` until a separate observation-only adapter exists.
- Missing `expected` values for DOM/TEXT/URL fail explicitly instead of being interpreted as an empty match.
- Added scoped, metadata-only reconciliation evidence with a stable run/effect/state-derived key. The evidence includes only node kind, verification mode, decision, state fingerprint, and page origin; it does not persist the expected text/selector, DOM payload, cookies, credentials, raw exception text, or screenshots.
- Exported the adapter through `@automation/aws`.
- Added regression tests covering positive URL/TEXT/DOM observations, conservative negative observations, zero browser-action dispatch, tenant-scoped metadata evidence, absence of expected text in evidence, unsupported/malformed verification contracts, observation uncertainty, and evidence-storage failure.
- No dependency or third-party source was added. Existing architecture and quality-gate guarantees already required this observation-only behavior, so those documents did not require semantic changes in this slice.

### Invariants and failure-mode review

- Observation cannot authorize execution. This adapter can return only classification data and evidence references; it has no browser-action capability in its public/narrow runtime surface.
- `ALREADY_APPLIED` requires a positive observation of the workflow's existing verification contract.
- `DEFINITELY_NOT_APPLIED` remains unavailable from these positive-only verification contracts. Negative state is `AMBIGUOUS`, preserving fail-closed recovery.
- Browser timeout/closed-session uncertainty is classified as retryable `TRANSIENT_NETWORK`; other unexpected observation failures are non-retryable `UNKNOWN`. Neither path returns a reconciliation decision.
- Evidence persistence failure is non-retryable `UNKNOWN` and prevents a decision from being returned to the coordinator, preserving the rule that reconciliation evidence and decision handling are not silently decoupled.
- MODEL/CUSTOM are rejected with `NOT_CONFIGURED`; no model fallback is invoked implicitly.

### Concurrency / idempotency / persistence review

- The adapter itself is read-only with respect to the target site. Concurrent inspection may duplicate browser reads and metadata writes but cannot duplicate the external workflow action.
- Durable decision authority remains in `HumanResumeEffectReconciliationStore`; this adapter does not bypass or replace its conditional first-writer-wins semantics.
- Evidence keys include stable run, effect, and page-state digests. Repeated inspection of the same effect in the same observed state is naturally idempotent at the evidence-key level, while a changed observed page state produces a different evidence object.
- No additional lock or lease was introduced; current duplicate-inspection cost remains accepted until it becomes operationally material.

### Security / tenancy review

- Artifact writes use `context.scope` from the already tenant/user-scoped reconciliation identity.
- Evidence paths hash scoped run/effect identity rather than embedding raw tenant/user/run/effect identifiers in object keys.
- Reconciliation evidence intentionally excludes screenshots because a paused browser may contain user-entered secrets or private page content.
- The positive expected value is used only in-memory for inspection and is not written into metadata evidence.
- Classified errors surface fixed messages; underlying provider/storage error text remains only as an internal cause and is not placed into reconciliation records or evidence.

### Timeout, retry, cost, scaling, and user recovery review

- DOM/TEXT visibility checks are bounded by the workflow verification timeout. URL observation is immediate.
- The adapter adds one metadata artifact write per performed inspection; it adds no model call and no action-capable browser operation.
- Duplicate concurrent inspection can still add browser/S3 cost, but target-site effect cost remains zero.
- A positive observation enables the existing future `ALREADY_APPLIED` path; a negative observation keeps the user in a recoverable ambiguous state rather than risking a duplicate action.
- This slice does not enable automatic lease reacquisition, successor replay, or checkpoint advancement.

### Known risks / unresolved questions

- Because `VerificationSpec` currently describes only positive expected state, this adapter cannot safely produce `DEFINITELY_NOT_APPLIED`. A future explicit absence/idempotency proof contract is required before negative observation may grant retry permission.
- The worker still does not instantiate this verifier during expired-lease crash recovery; production recovery remains intentionally disabled.
- `ALREADY_APPLIED` still needs durable checkpoint/output reconstruction before the successor can be skipped safely.
- `AMBIGUOUS` still needs explicit worker transition/audit/UI wiring back to human attention.
- Stable effect-ID derivation is still not wired to the first resumed successor at runtime.
- Effect preparation/reconciliation audit events remain incomplete.
- AWS SDK peer-version alignment remains queued.
- Live AgentCore/S3 behavior is not credential-validated; deterministic tests and CI remain the current evidence.

## 2026-08-19 — Provider-neutral ALREADY_APPLIED checkpoint reconstruction plan

### Completed in this slice

- Added `planAlreadyAppliedHumanResumeRecovery`, a pure provider-neutral recovery primitive for the post-effect checkpoint reconstruction path.
- The planner accepts only a durable `DECIDED` / `ALREADY_APPLIED` effect record matching the exact tenant, user, run, paused HUMAN node, immutable workflow version, and declared first successor.
- It reconstructs the checkpoint that ordinary successful execution would have produced after that successor: marks the HUMAN node and successor completed, merges only declared output bindings into durable variables, appends reconciliation evidence, clears retry/fingerprint/failure state, and advances to the successor's declared next node without executing the successor again.
- Multi-successor control flow remains constrained: reconstructed `nextNodeId` must exactly match a declared successor; arbitrary destinations are rejected.
- The planner requires the reconciled successor to remain side-effecting and explicitly verifiable, preventing the recovery record from being repurposed for a different node class.
- Added tests for output/evidence reconstruction, immutable input preservation, branch validation, durable-decision enforcement, tenant/user/run isolation, control-flow drift, non-verifiable successor rejection, workflow/run/checkpoint identity drift, and timestamp validation.
- Exported the planner through `@automation/core`. No dependency or third-party source was added.

### Invariants / concurrency / persistence review

- This planner is deliberately pure and is not execution permission. It does not acquire/reacquire leases, mutate the reconciliation authority, persist a checkpoint, update a run, or dispatch browser/model work.
- A caller must still hold valid same-resolution execution ownership before using the plan in production.
- The function does not persist a run/checkpoint pair because the current repository interfaces do not provide an atomic combined transition. Wiring this into the worker before defining the crash semantics of checkpoint-write vs run-update ordering would create a new recovery race, so integration remains intentionally deferred.
- Re-running the pure planner with the same durable inputs is deterministic and side-effect free. It cannot duplicate a target-site action.
- Existing checkpoint variables/evidence are preserved; only declared output bindings are merged. Arbitrary reconstruction outputs do not become durable variables unless the immutable node mapped them.
- Old human failure/fingerprint/attempt state is cleared exactly as on a successful resumed successor, while the prior evidence history remains retained.

### Security / timeout / retry / observability / cost review

- No cloud/provider-specific type enters core. AWS and a future Google adapter can supply the same reconstruction data.
- Tenant/user/run/version/HUMAN-node/successor identity is validated before any plan is returned.
- The planner stores or logs no secrets and introduces no browser/model/network call, timeout, retry loop, or additional cloud cost.
- Reconciliation evidence references may be carried forward; raw DOM/browser content remains outside the checkpoint authority as before.
- Invalid or ambiguous reconciliation states fail closed and cannot create a synthetic success checkpoint.

### Validation status

- Incoming head `11be1b0804a70174fa0279233b359de9ad21ac9d` is confirmed green in GitHub Actions CI #119.
- Local installation/check/test is still unavailable because the execution container cannot resolve `github.com`; no local pass is claimed.
- Code, tests, export, and this progress update are being published as one Git-data commit. GitHub Actions on that exact commit is authoritative.

### Known risks / next highest-value tasks

1. Define a lease-owned durable recovery transition that can persist the reconstructed checkpoint and run-state advancement with explicit crash semantics; do not rely on an unsafe read-then-write pair.
2. Wire same-resolution expired-lease recovery to consume the observation-only verifier and this planner: skip action on `ALREADY_APPLIED`, execute only on durable `DEFINITELY_NOT_APPLIED`, and return to human attention on `AMBIGUOUS`.
3. Define an explicit proof-of-absence/idempotency contract before any production verifier may return `DEFINITELY_NOT_APPLIED`.
4. Add redacted audit milestones for effect preparation, inspection, decision, reconstructed advancement, and ambiguity fallback.
5. Deliberately align AWS SDK peer versions and rerun the full workspace suite.
6. Continue outward through capture -> compile -> test -> publish -> schedule after crash recovery is fully reconciled end to end.
