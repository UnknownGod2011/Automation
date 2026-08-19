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

## Validation history before this slice

- CI #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims.
- CI #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- CI #111 passed on `b13d815bf087da799f441991378bb715fcd41c4a` with durable human-resume execution leases and orchestration lease gating.
- CI #112 passed on `2c5cde839a3aebe229942fa5ee7dba5e4e16ea7c` with production human-resume runtime reconstruction.
- CI #114 passed on `130510e16b16e8b12a77d995fb90e729ef09a368` after heartbeat ownership-loss regression alignment.
- CI #115 passed on `59bef6806f21ff8710b17dc334cf40b1c2f48c88` with the durable redacted human-resume audit trail. This was the validated head before the current slice.
- The execution container cannot resolve `github.com`, so no local install/check/test pass is claimed. GitHub Actions is authoritative.

## 2026-08-19 — Durable first-successor effect reconciliation authority

### Completed in this slice

- Added provider-neutral `HumanResumeEffectIdentity`, `HumanResumeEffectRecord`, `HumanResumeEffectReconciliationStore`, and typed reconciliation outcomes.
- A first resumed successor is identified by tenant + user + run + paused HUMAN node + successor node + resolution ID + stable effect ID. The durable key is the ownership + run + paused-node boundary, so only one first-successor effect identity can win for that pause.
- `prepare` is idempotent only for the exact same identity. A competing effect ID, resolution ID, or successor returns `CONFLICT` rather than silently replacing the winner.
- Added the closed reconciliation decision set `ALREADY_APPLIED`, `DEFINITELY_NOT_APPLIED`, and `AMBIGUOUS`. A prepared effect can receive exactly one immutable decision. Repeating that same decision returns `REPLAY`; attempting to change it returns `CONFLICT`.
- Added `humanResumeEffectRetryAllowed`, which grants automatic retry permission only for `DEFINITELY_NOT_APPLIED`. `ALREADY_APPLIED` and `AMBIGUOUS` are explicitly non-retrying outcomes.
- Added `AwsDynamoHumanResumeEffectReconciliationStore`. Preparation uses a conditional `PutCommand`; decision persistence uses a conditional `UpdateCommand`; losing writers use strongly consistent reads to classify the durable winner.
- DynamoDB transport, throttling, permission, and other non-conditional failures propagate instead of being guessed as replay/conflict/decision outcomes.
- Added provider-neutral tests for exact-identity replay, competing-identity conflict, immutable decision replay/conflict, tenant/user isolation, prepare-before-decide enforcement, and retry authorization.
- Added AWS adapter tests for atomic prepare, strongly consistent contention reads, competing identity conflict, immutable decision semantics, tenant/user partition isolation, and propagation of non-conditional DynamoDB uncertainty.
- Updated core/AWS exports and the architecture/quality contracts. No dependency or third-party source was added.

### Invariants and failure-mode review

- This reconciliation record is execution authority, not best-effort telemetry. Storage uncertainty fails closed.
- A pause boundary cannot acquire a second first-successor effect identity after one has been prepared. This prevents a replacement worker from silently changing the operation it is trying to reconcile.
- A durable decision cannot be rewritten. This prevents two workers/verifiers from alternately authorizing and suppressing retry.
- `ALREADY_APPLIED` never authorizes replay. Recovery must advance using verification/checkpoint reconstruction once runtime wiring exists.
- `DEFINITELY_NOT_APPLIED` is the only state from which an automatic retry can eventually be permitted.
- `AMBIGUOUS` remains a human-recovery state. The platform must not guess whether an external operation happened.
- This slice deliberately does not enable automatic lease reacquisition or successor replay. Runtime verification has not yet been wired to create/resolve the effect record, so the existing fail-closed no-replay behavior remains in force.

### Concurrency / idempotency review

- Competing `prepare` calls serialize through one conditional DynamoDB put. The loser reads the winner consistently and can only return `REPLAY` for exact identity equality; otherwise it returns `CONFLICT`.
- Competing `decide` calls may both observe `PREPARED`, but the conditional update permits only one transition to `DECIDED`. The loser reads the winner consistently and returns same-decision `REPLAY` or different-decision `CONFLICT`.
- There is no read-then-unconditional-write path that can overwrite a winner.
- Stable effect-ID generation is intentionally not hidden inside the store. The later runtime integration must derive/inject a deterministic effect ID for the first resumed successor before execution starts.

### Security / tenancy review

- Records are partitioned by a derived tenant/user scope and additionally keyed by run + paused HUMAN node.
- Durable payload identity is validated on read before the record is returned.
- The reconciliation schema contains only bounded identity fields, state, timestamps, and one closed decision enum. It has no arbitrary metadata, browser payload, cookies, auth headers, DOM data, provider secrets, raw exception text, or lease owner token.
- A client-selected record from another tenant/user cannot be addressed through the adapter because the ownership partition is derived server-side from the authorized scope.

### Timeout, retry, observability, cost, and scaling review

- Reconciliation adds at most one prepare write and one decision write per human-resume pause boundary, plus strongly consistent reads only on contention/recovery. It does not add browser/model calls in this slice.
- The storage path is run/node scoped and does not require a table scan. Hot-key risk is naturally limited to workers contending on the same human pause, where serialization is required for correctness.
- Storage failure does not widen browser retry budgets or create another target-site attempt.
- The audit trail is not yet extended with reconciliation decisions; that remains observability work after the authority is integrated into runtime execution.

### User-visible failure recovery

- `ALREADY_APPLIED`: the eventual recovery path should tell the user the effect was found already present and continue only after state reconstruction/verification.
- `DEFINITELY_NOT_APPLIED`: the eventual recovery path may retry once ownership is safely reacquired and the stable effect identity is preserved.
- `AMBIGUOUS`: the run must remain/return to a human-attention state and explain that the platform cannot safely determine whether repeating the action would duplicate an external effect.
- Storage uncertainty itself must surface as a recoverable platform failure, never as an inferred reconciliation result.

### Validation status for this slice

- The prior head `59bef6806f21ff8710b17dc334cf40b1c2f48c88` is confirmed green in GitHub Actions CI #115 before this change.
- Code, tests, exports, architecture, quality gates, and this progress entry are being published together in one Git-data commit to avoid per-file CI churn.
- No local validation is claimed because the execution container cannot resolve GitHub/package dependencies.
- GitHub Actions on the exact resulting commit is authoritative. If it fails, inspect job logs and root-cause before any corrective commit; do not weaken checks.

### Known risks / unresolved questions

- Runtime verification is not yet wired to the reconciliation store, so automatic crash recovery remains disabled.
- The current workflow verification interface returns a boolean; classifying `DEFINITELY_NOT_APPLIED` versus `AMBIGUOUS` after a crash will require a dedicated reconciliation verifier rather than overloading ordinary node verification semantics.
- `ALREADY_APPLIED` still needs a safe checkpoint/variable reconstruction path so recovery can advance without rerunning the action.
- Stable effect-ID generation must be integrated with the first resumed successor and remain identical across worker replacement.
- Heartbeat/runtime/profile/reconciliation audit milestones are still incomplete.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains.
- The AWS SDK peer-version warning still needs deliberate package alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic tests are the current evidence.

### Next highest-value tasks

1. Add a provider-neutral reconciliation verifier that can inspect the first resumed successor's expected effect after worker replacement and return `ALREADY_APPLIED`, `DEFINITELY_NOT_APPLIED`, or `AMBIGUOUS` without executing the action.
2. Wire `HumanResumeWorker` recovery so expired same-resolution ownership may proceed only after durable effect preparation + reconciliation; retry only on `DEFINITELY_NOT_APPLIED`, advance safely on `ALREADY_APPLIED`, and pause on `AMBIGUOUS`.
3. Persist redacted audit events for effect preparation/reconciliation, heartbeat ownership loss, runtime reconstruction, and profile persistence.
4. Deliberately align AWS SDK peer versions and rerun the full workspace suite.
5. Continue outward through capture -> compile -> test -> publish -> schedule once crash recovery is fully reconciled end to end.
