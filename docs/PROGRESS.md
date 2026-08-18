# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

Older hourly entries are intentionally consolidated here so this remains an engineering handoff rather than an ever-growing transcript.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict pnpm/TypeScript monorepo with shared `@automation/contracts` domain boundary.
- Versioned workflow graphs, run/checkpoint records, bounded retry/backoff, failure classification, verification requirements, occurrence idempotency, and multi-tenant ownership.
- Provider-neutral repositories/ports plus deterministic in-memory adapters.
- Guarded run lifecycle state transitions, scheduled-run idempotency, automation concurrency leases, retry fingerprints/circuit breaking, semantic fallback constraints, and explicit effect verification.
- Provider-neutral execution engine preserving immutable workflow version, variables, evidence, and checkpoints across retry/pause/resume.
- Scheduled-run coordinator/worker boundaries with browser session/profile reconstruction, profile-before-success persistence, and checkpoint-coupled automation-lease renewal.
- AWS DynamoDB/S3/browser-profile/session/identity/reasoning/Playwright adapters behind provider-neutral contracts.
- Explicit `HUMAN` workflow nodes now support pause -> human repair -> resume -> declared successor -> success, while ambiguous human branching is rejected before persisted state leaves `WAITING_FOR_HUMAN`.
- Durable human-resolution claims use stable resolution IDs and atomic conditional persistence. Same-ID delivery is `REPLAY`; competing delivery is `CONFLICT`.
- `HumanResumeOrchestrator` executes only newly `ACCEPTED` claims and requires a durable human-resume execution lease before browser/model work.
- Human-resume execution leases are tenant/user/run/node/resolution scoped, have opaque owner tokens, support conditional renewal, and complete into durable tombstones. AWS uses conditional DynamoDB writes and strongly consistent contention reads.

## Validation history

- CI #95 passed on `1dc9ad43b32d628d81f50bb83a221b88321c1359` after Playwright package/import fixes and explicit-HUMAN resume regression coverage.
- CI #103 passed on `b7951c0d5c1c4429570959ca6e533ab6769dab10` with durable DynamoDB human-resolution claims.
- CI #107 passed on `1d9f605b8e1e137e7882a566a4b549b3f6c7e029` with guarded human-resume orchestration.
- CI #110 passed on `a5b01027e521fcefb7a5fbc9e910df0424af9d1f`.
- CI #111 passed on `b13d815bf087da799f441991378bb715fcd41c4a` with durable human-resume execution leases, AWS lease adapter coverage, and orchestration lease gating.
- The execution container cannot reliably resolve GitHub/package dependencies, so no local install/check/test pass is claimed. GitHub Actions is authoritative.

## 2026-08-19 — Production human-resume runtime reconstruction

### Completed in this slice

- Added provider-neutral `HumanResumeWorker`, implementing `HumanResumeExecutor` without introducing AWS/GCP types into core.
- The worker revalidates the accepted resolution/lease/run/checkpoint boundary before loading automation metadata or opening browser compute.
- Resume refuses to run if the automation is no longer `ACTIVE`, so a user disabling an automation while it waits for human intervention is respected.
- The worker loads the immutable workflow version bound to the durable run rather than the automation's currently published version. Publishing a newer version cannot silently migrate an in-flight paused run.
- The worker requires the automation's server-resolved browser profile reference and reconstructs a fresh browser execution runtime through the existing `BrowserSessionManager` and `BrowserExecutionRuntimeFactory` ports.
- Human-resume lease ownership is conditionally renewed before browser/model startup. An expired/lost lease fails closed before session creation.
- Added a lease-renewing checkpoint repository for human resume. Every durable checkpoint write renews execution ownership first, mirroring the existing scheduled-worker fencing pattern.
- The worker calls `WorkflowExecutionEngine.execute(..., resumeFromHuman: true)` only after runtime reconstruction and lease renewal.
- `FinalizingRunRepository` is reused so browser-profile persistence occurs before a resumed run may durably transition to `SUCCEEDED`.
- If resumed execution reaches another human pause, the browser profile is persisted before the fresh runtime is torn down.
- Runtime/session cleanup is best-effort and can emit sanitized cleanup warnings; cleanup messages contain no lease owner token, cookies, browser headers, or profile contents.
- Added deterministic regression coverage for HUMAN -> END success, immutable workflow-version pinning despite a newer published version, disabled-automation rejection before browser startup, expired lease rejection before browser startup, second-HUMAN profile persistence, profile-save failure preventing durable success, and mismatched lease-boundary rejection.
- No new dependency or third-party source was introduced.

### Invariants and failure-mode review

- Claim acceptance, execution lease ownership, run/checkpoint identity, immutable workflow version, and browser profile are all revalidated at the production resume-worker boundary.
- Browser/model startup is forbidden without a live renewable execution lease.
- A checkpoint is never written by the human-resume worker unless lease renewal succeeded immediately beforehand.
- A successful engine result is not enough for durable success: profile persistence must succeed before the `SUCCEEDED` run update.
- A resumed run that pauses again saves browser state before ephemeral runtime teardown so the next human repair starts from the latest authorized session state.
- Storage uncertainty during lease renewal propagates as failure; the worker never guesses that ownership still exists.
- Automatic replay after worker crash remains disabled. Renewal reduces accidental expiry during healthy execution but does not solve the unknown-side-effect window after a process dies.
- The worker does not auto-migrate a paused run onto a newly published workflow version.

### Security and tenant isolation review

- Automation, workflow, run, checkpoint, lease, and browser-profile resolution all use the command's tenant/user scope.
- A forged lease with a different tenant/user/run/node/resolution boundary is rejected before browser startup.
- Browser profile references remain server-resolved from the owned automation; the human command cannot choose an arbitrary profile.
- Lease owner tokens remain operational capability material and are not added to user-visible output or cleanup warnings.
- No provider keys, cookies, auth headers, session storage, or raw browser-profile contents are added to metadata persistence.

### Timeout, retry, observability, cost, and scaling review

- This slice does not add automatic human-resume retries; claim replay remains non-executing.
- Healthy resume execution adds conditional lease renewals before runtime startup, before checkpoint persistence, before success profile persistence, and before pause cleanup profile persistence. These writes are intentionally cheaper than allowing stale workers to keep browser/model ownership.
- The worker continues using bounded workflow-node retry semantics from `WorkflowExecutionEngine`; no retry budget is broadened.
- Browser session timeout remains an explicit dependency. Lease TTL is separately explicit and must be configured so long-running nodes renew at checkpoint boundaries without relying on an in-process mutex.
- Cleanup failures can emit sanitized warnings, but structured durable audit events are still missing.

### Validation status for this slice

- The code, tests, public export, and this progress handoff are being published as one atomic multi-file commit using Git data primitives.
- No CI-pass claim is made until GitHub Actions completes successfully on the resulting exact commit SHA.
- If CI fails, logs must be inspected and root-caused before any corrective commit; checks must not be weakened.

### Known risks / unresolved questions

- Checkpoint-coupled renewal cannot protect a single browser/model action that runs longer than the remaining lease TTL before producing a checkpoint. A future execution-guard/heartbeat must renew during long node execution and be able to stop further side effects after ownership loss.
- Automatic crash recovery after lease expiry is still intentionally disabled until node-level effect reconciliation/idempotency can distinguish already-applied external effects from safe retries.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains.
- Structured redacted audit events for human pause/claim/lease/resume lifecycle are not yet persisted.
- The AWS SDK peer-version warning still needs deliberate package alignment rather than suppression.
- Live AgentCore/DynamoDB behavior remains unvalidated without cloud credentials; deterministic tests remain the current evidence.

### Next highest-value tasks

1. Add an execution-ownership heartbeat/guard that can renew during a long node and fence additional browser/model side effects immediately after lease loss, not only at checkpoint boundaries.
2. Add first-successor effect-reconciliation/idempotency state so same-resolution recovery after a crashed worker can verify-before-retry instead of duplicating external actions.
3. Add structured, redacted audit events for human pause, resolution claim, lease acquisition/renewal/loss/completion, runtime reconstruction, successor start, and completion/failure.
4. Deliberately align the AWS SDK peer versions and rerun the full workspace suite.
5. Continue outward through capture -> compile -> test -> publish -> schedule after the recovery path is fully fenced.
