# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

Older hourly entries were consolidated on 2026-08-19 to keep this file useful as an engineering handoff rather than an ever-growing transcript. The guarantees, validated heads, unresolved risks, and next production slices are preserved below.

## Product/lifecycle target

The required production lifecycle remains:

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

### Domain and execution core
- Established the strict pnpm/TypeScript monorepo and shared `@automation/contracts` domain boundary.
- Added versioned workflow graphs, run/checkpoint records, failure classification, bounded retry/backoff contracts, verification requirements, provider credential metadata, occurrence idempotency, and multi-tenant ownership fields.
- Added provider-neutral repositories/ports plus deterministic in-memory adapters.
- Added guarded run lifecycle state transitions, idempotent scheduled-run creation, automation concurrency leases, durable checkpoints, retry fingerprints/circuit breaking, semantic fallback constraints, and explicit effect verification.
- Added a provider-neutral execution engine that preserves immutable workflow versions, variables, evidence, and checkpoints across retry/pause/resume.
- Added run preflight/finalization/worker boundaries, browser-session/profile abstractions, reasoning/provider interfaces, and deterministic verification interfaces.

### AWS production adapters
- Added DynamoDB state repositories/locks, S3 artifact storage, browser-profile/session adapters, identity/credential boundaries, reasoning adapter scaffolding, and Playwright runtime integration behind provider-neutral interfaces.
- Added package-level public exports and deterministic command-level tests so AWS SDK behavior is exercised without live credentials.
- No new dependency is introduced by the human recovery work; the existing controlled AWS SDK dependencies are reused.

### Explicit HUMAN recovery
- Fixed explicit `HUMAN` workflow nodes so pause -> human repair -> resume can advance to the declared successor and complete.
- Resume validates topology before mutating a durable run: until typed human branch selection exists, an explicit `HUMAN` node must have exactly one successor.
- Resume preserves run identity, immutable workflow version, variables, accumulated evidence, and checkpoint continuity while clearing the stale human-failure/fingerprint circuit.
- Regression coverage includes action -> verification -> HUMAN pause -> resume -> END success and ambiguous-successor rejection before durable state mutation.

### Durable human-resolution claims
- Added provider-neutral `HumanResolutionCommand`, `HumanResolutionClaimStore`, and `HumanResolutionCoordinator`.
- Commands are scoped to tenant + user + run + paused node and carry a stable resolution ID.
- The coordinator proves the run is still `WAITING_FOR_HUMAN`, the checkpoint belongs to the same run/automation/workflow version, and the expected node still matches before a claim is created.
- Added `AwsDynamoHumanResolutionClaimStore`: first resolution wins with a conditional write; losing writers use a strongly consistent read to return same-ID `REPLAY` or different-ID `CONFLICT`.
- Transport/throttling/permission uncertainty is propagated rather than guessed.
- Duplicate/conflicting delivery is rejected before browser/model startup.

### Guarded human-resume orchestration
- Added provider-neutral `HumanResumeOrchestrator` and `HumanResumeExecutor`.
- Claim idempotency is not execution idempotency: `REPLAY` and `CONFLICT` are non-executing outcomes.
- Prior to the execution-lease slice below, only a newly `ACCEPTED` claim could start the executor; worker failure then failed closed and replay could not silently rerun side effects.

## Validation history before the current slice

- GitHub Actions run #95 passed on `1dc9ad43b32d628d81f50bb83a221b88321c1359` after root-causing and fixing Playwright package/import defects plus explicit HUMAN resume regressions.
- GitHub Actions run #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims and contention tests.
- GitHub Actions run #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- GitHub Actions run #110 passed on `a5b01027e521fcefb7a5fbc9e910df0424af9d1f`, the starting head for the current execution-lease slice.
- The execution container still cannot resolve `github.com`, so no local clone/install/check/test pass is claimed. GitHub Actions remains authoritative.

## 2026-08-19 — Durable human-resume execution ownership

### Completed in this slice
- Added provider-neutral `HumanResumeExecutionLeaseStore` and `HumanResumeExecutionLease` contracts with explicit `ACTIVE`/`COMPLETED` state and `ACQUIRED`, `BUSY`, `COMPLETED`, and `CONFLICT` acquisition outcomes.
- Lease identity is scoped to tenant + user + run + paused node + accepted resolution ID and owned by an opaque worker token.
- Added deterministic in-memory lease behavior for local/core tests.
- Added `AwsDynamoHumanResumeExecutionLeaseStore` using conditional DynamoDB writes so only one live execution owner can exist across workers.
- An expired lease may be reacquired only for the same resolution ID. A competing resolution ID remains a permanent conflict.
- Losing acquisition writers use a strongly consistent read to classify the durable winner.
- Renewal and completion require the same resolution ID + owner token + `ACTIVE` state + unexpired lease through DynamoDB conditional expressions.
- Completion persists a durable `COMPLETED` tombstone instead of deleting ownership state, preventing a finished human-resume boundary from becoming executable again after time passes.
- Non-conditional DynamoDB uncertainty propagates; throttling/transport/permission errors are not reclassified as acquisition, conflict, renewal, or completion.
- Updated `HumanResumeOrchestrator`: a newly accepted human resolution must now acquire durable execution ownership before invoking browser/model work.
- The executor receives the active lease so production runtime reconstruction can be tied to explicit execution ownership.
- Successful execution must durably complete the lease before the orchestrator reports `EXECUTED`. If ownership expired or was lost before completion, orchestration fails rather than claiming durable success.
- Executor failure intentionally leaves the lease active until expiry and claim replay remains non-executing.
- Added core tests for single-owner acquisition, overlap rejection, same-resolution reacquisition after expiry, competing-resolution conflict, renewal, completed tombstones, stale-expiry rejection, orchestration lease gating, concurrent duplicate delivery, and worker-failure fail-closed behavior.
- Added AWS adapter tests for conditional single-owner acquisition, strongly consistent contention reads, same-resolution expiry recovery at the storage-contract layer, competing-resolution conflict, renewal, completion tombstones, stale completion rejection, tenant isolation, and propagation of non-conditional DynamoDB failure.
- Updated `ARCHITECTURE.md` and `QUALITY_GATES.md` with the new execution-ownership guarantee, owner-token security boundary, storage uncertainty semantics, and regression requirements.

### Invariants and failure-mode review
- Human claim acceptance and human execution ownership are separate durable facts.
- `REPLAY` is still not execution permission. The current orchestrator does not automatically reacquire an expired lease for a replayed claim.
- The lease store supports same-resolution reacquisition after expiry because production crash recovery will need that primitive, but the orchestration layer deliberately does not yet convert it into side-effect replay.
- A lease prevents concurrent workers; it does not prove whether an external action happened immediately before a crashed worker lost ownership.
- Automatic crash recovery therefore remains blocked until node-level effect reconciliation/idempotency can decide whether the successor should be verified, continued, or safely retried.
- Lease completion after expiry is rejected. A worker that runs longer than the lease TTL must renew before expiry; production browser/runtime wiring must provide renewal during long execution.
- A storage/network error during acquisition/renewal/completion is uncertain and propagates to the caller. No retry outcome is invented.
- Completed lease state is durable and non-reacquirable.
- Core contracts contain no AWS/GCP SDK types, preserving Google adapter compatibility.

### Security and tenant isolation review
- Lease keys use the existing tenant/user ownership partition plus run/node identity.
- Durable payload identity is validated on read.
- Worker owner tokens are capability material used for compare-and-set ownership. They must not be sent to clients, exposed in user-visible run history, or written to logs.
- The slice adds no provider keys, cookies, browser storage, auth headers, or target-site credentials to metadata persistence.
- Human resolution ownership still must be proven by `HumanResolutionCoordinator` before lease acquisition can reach the executor path.

### Retry, timeout, observability, cost, and scaling review
- No automatic execution retry is added by this slice.
- Uncontended resume ownership adds one DynamoDB conditional write before browser/model startup and one conditional completion write afterward; duplicates remain cheaper than opening browser/model compute.
- Contention adds a failed conditional write plus strongly consistent read.
- Lease TTL is explicit and must be sized/renewed by the production worker; an unbounded hidden in-process lock is not used.
- Future audit events should record claim accepted/replayed/conflicted, lease acquired/busy/completed/expired, executor start/finish, and ownership-loss failure while redacting owner tokens and sensitive browser/model data.

### Validation status for this slice
- Code and documentation were assembled as one atomic multi-file Git commit using Git data primitives so the branch receives at most one normal CI-triggering push for this run.
- Local execution is unavailable because the container cannot resolve `github.com`; no local check/test success is claimed.
- GitHub Actions on the resulting commit must be inspected before this slice is called validated. If CI fails, logs must be root-caused before any corrective commit.

### Known risks / unresolved questions
- Production resume worker wiring is still incomplete: browser profile reconstruction + `WorkflowExecutionEngine` resume must be invoked through `HumanResumeOrchestrator` while a valid lease is held.
- Lease renewal is implemented as a contract/adapter operation but not yet driven by a long-running production resume worker heartbeat.
- Automatic crash recovery after lease expiry remains intentionally disabled until external-effect reconciliation is defined.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor restriction remains.
- Structured human-resolution/lease audit events are not yet persisted.
- The existing AWS SDK peer-version warning still needs deliberate alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic command-level tests are the current evidence.

### Next highest-value tasks
1. Wire a production human-resume executor that reconstructs the authorized browser profile/runtime and calls `WorkflowExecutionEngine` with `resumeFromHuman=true` only while a valid lease is held; add lease renewal for long executions.
2. Add effect-reconciliation/idempotency state around the first side-effecting successor so expired same-resolution leases can recover safely without duplicating external actions.
3. Add structured, redacted audit events for human pause, resolution claim, lease lifecycle, resume checkpoint, successor start, and completion/failure.
4. Deliberately align the AWS SDK peer versions and run the full workspace suite.
5. Continue outward through capture -> compile -> test -> publish -> schedule once the recovery path is end-to-end guarded.
