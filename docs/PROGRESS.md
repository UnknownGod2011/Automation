# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md` and `ARCHITECTURE.md` before changing implementation boundaries.

## 2026-08-18 — Bootstrap

### Completed
- Initialized repository.
- Locked product end goal and non-negotiable engineering properties.
- Locked control-plane/execution-plane architecture and failure semantics.
- Established pnpm TypeScript monorepo layout with strict compiler settings.
- Added `@automation/contracts` as the shared domain boundary.
- Defined automation states, run states, workflow node kinds, failure codes, retry policy, verification contract, workflow graph, automation/run/checkpoint records, provider credential metadata, and occurrence idempotency key helper.
- Added domain tests for workflow graph integrity and scheduled-run idempotency.
- Added GitHub Actions CI for type checking and tests.
- Added repository ignores.

### Validation
- Manually reviewed strict TypeScript access patterns and corrected an unsafe test index access.
- Attempted clean clone + `pnpm install && pnpm check && pnpm test` in the execution container, but the container could not resolve `github.com`; no local test-pass claim is made.
- GitHub Actions is the authoritative validation path until a network-capable local checkout is available.

### Architectural decisions locked
- Durable orchestration state belongs outside the model/browser runtime.
- Workflow IR is semantic/versioned, not generated one-off Playwright source.
- Deterministic execution precedes semantic/model fallback.
- Every consequential node has bounded retries and effect verification.
- Human takeover closes ephemeral browser compute and resumes from persisted checkpoint/profile later.
- BYOK secrets stay behind a secret/token-vault adapter; normal tables hold references/health metadata only.
- Multi-tenant ownership/idempotency/concurrency fields exist from the first schema.

## 2026-08-18 — Provider-neutral core ports and local adapters

### Completed
- Added `@automation/core`, with no AWS or GCP SDK dependency.
- Defined explicit ports for AutomationRepository, WorkflowVersionRepository, RunRepository, CheckpointRepository, AutomationLockManager, ArtifactStore, BrowserProfileStore, CredentialVault, CredentialMetadataRepository, SchedulerPort, NotificationPort, ReasoningProvider, BrowserExecutor, and VerificationEngine.
- Added deterministic in-memory adapters for metadata repositories, immutable workflow versions, idempotent runs, checkpoints, expiring automation locks, artifacts, browser-profile references, credential secrets/metadata, schedules, and notifications.
- Added explicit run lifecycle state machine with guarded transitions, terminal-state handling, timestamps, failure requirements, retry/human-resume paths, and rejection of impossible transitions.
- Added tests proving immutable workflow versions, ordered version listing, at-least-once run deduplication by occurrence key, immutable run identity, concurrency-lock exclusion/expiry, lock-owner protection, cross-tenant secret isolation, legal run lifecycle, retry/human resume, invalid transition rejection, and structured terminal failure requirements.
- Adjusted workspace package type resolution so clean `pnpm check` does not depend on a prior `dist` build.

### Validation
- Reviewed new code against strict TypeScript settings (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Corrected an invalid test-only type-use expression before finalizing the slice.
- Reviewed PR review threads; no unresolved inline review threads were present at this checkpoint.
- GitHub combined commit status currently reports CodeRabbit success. GitHub Actions workflow discovery through the connector has not yet surfaced the newest run, so no CI-pass claim is made for this slice yet.
- Local container execution remains unavailable because the prior environment could not resolve GitHub/package dependencies; tests are therefore designed to be deterministic and credential-free while repository CI remains authoritative.

### Architectural decisions reinforced
- Core ports are the only dependency direction for cloud adapters: AWS and Google implementations must implement these interfaces rather than introducing cloud APIs into workflow/compiler/executor code.
- Workflow-version storage is immutable by contract.
- At-least-once scheduler delivery is absorbed at RunRepository creation using occurrence identity.
- Automation concurrency is an explicit lease, not an in-process mutex.
- Secret material and credential metadata remain separate abstractions.
- Run state is governed by an explicit state machine; adapters may persist state but must not invent lifecycle transitions.

### Next highest-value tasks
1. Build the provider-neutral execution engine that walks WorkflowGraph nodes using BrowserExecutor/ReasoningProvider/VerificationEngine and persists checkpoints after meaningful effects.
2. Add retry-state fingerprints and deterministic retry/backoff planning; prove repeated unresolved states transition to WAITING_FOR_HUMAN instead of looping.
3. Add mock BrowserExecutor, ReasoningProvider, and VerificationEngine implementations and an end-to-end scheduled-run lifecycle test including deterministic success, semantic fallback, verification failure, pause, correction, and resume.
4. Add a run coordinator/preflight service around idempotent run creation, automation-state validation, immutable workflow loading, lock acquisition/release, browser-profile readiness, and credential readiness.
5. Add AWS adapter package/infrastructure skeleton only after the above execution lifecycle is green: DynamoDB/S3/SQS/Step Functions/EventBridge/SES/AgentCore behind existing ports.
6. Add environment/config contracts that produce explicit NOT_CONFIGURED states when cloud/provider credentials are absent.
7. Add Next.js control-plane UI only after lifecycle/domain APIs are stable enough not to encode temporary assumptions.

### Current blockers
- No AWS credentials/API keys are required for current development. Real cloud integration tests will remain disabled until credentials exist.
- Current connector tooling has not surfaced a GitHub Actions run for the latest commits yet; validation status must be rechecked on the next run.
- Local container network could not reach GitHub during the bootstrap run; repository CI covers authoritative validation once surfaced.

## 2026-08-19 — Playwright CI repair and explicit HUMAN resume

### Completed
- Root-caused GitHub Actions run #91 instead of weakening CI. `pnpm check` failed because the new AWS Playwright runtime imported `RunRecord` from `@automation/core` instead of the shared contracts package and attempted to spread a plain object as constructor arguments for `ClassifiedExecutionError`.
- Corrected the `RunRecord` import boundary and passed `ErrorOptions` explicitly to `ClassifiedExecutionError`.
- Root-caused the subsequent AWS test failure in run #92: the Playwright executor and verifier compiled but were absent from the `@automation/aws` public package exports. Added the missing `playwright-runtime` export rather than bypassing the package surface in tests.
- Fixed the explicit `HUMAN` recovery lifecycle in `WorkflowExecutionEngine`. A run checkpointed on an explicit `HUMAN` node can now resume by marking that node completed, checkpointing its sole declared successor, clearing the human failure/fingerprint circuit, and continuing execution.
- Explicit `HUMAN` resume validates control flow before changing the persisted run from `WAITING_FOR_HUMAN` to `RUNNING`. Until typed human branch-selection output exists, zero or multiple successors are rejected rather than guessed.
- Preserved workflow variables, accumulated evidence, run identity, and immutable workflow version across explicit human resume.
- Added regression coverage for the full explicit-human lifecycle: deterministic action -> verified effect -> HUMAN pause -> human resume -> END success.
- Added a negative regression proving an ambiguous two-successor HUMAN resume throws before any run update and leaves the durable WAITING checkpoint unchanged.
- Updated `ARCHITECTURE.md` and `QUALITY_GATES.md` with the explicit-human resume invariant and pre-mutation ambiguity gate.

### Validation
- GitHub Actions run #91 failed at `pnpm check`; exact compiler errors were inspected before any source change.
- After the type fixes, run #92 passed `pnpm check` and then failed `pnpm test`; logs showed all Playwright runtime tests failing because the runtime classes were not exported from the package public surface.
- After the package export fix and explicit-human lifecycle implementation/tests, GitHub Actions run #95 completed successfully on commit `1dc9ad43b32d628d81f50bb83a221b88321c1359`: type checking, build, and the full workspace test suite passed.
- The final documentation commits in this run require their own latest-head CI result before this run is treated as fully validated; that result is checked after this progress entry is committed.
- No local test pass is claimed. The execution environment still cannot resolve GitHub/package network access reliably, so repository CI remains the authoritative validation path.

### Invariants and failure-mode review
- Explicit `HUMAN` nodes are durable pause boundaries, not browser actions and not semantic-reasoning actions.
- A human resume may skip only the exact explicit `HUMAN` node referenced by the durable checkpoint; a later distinct `HUMAN` node still pauses normally.
- Ambiguous human branching is rejected before persisted state mutation. The engine does not invent `nextNodeId` on behalf of a human.
- Existing recovery of a failed non-HUMAN node is unchanged: the repaired node is retried with its durable variables and a reset retry/fingerprint circuit.
- Retry budgets, timeout semantics, semantic fallback constraints, effect verification, and terminal failure classification were not broadened by this slice.
- The change introduces no new provider-specific dependency into core and therefore preserves AWS/Google adapter neutrality.

### Security, tenancy, observability, and scaling review
- No secret, browser-profile, credential, or authentication interfaces changed. No additional sensitive values are logged or persisted.
- Human resume continues through the existing ownership-scoped repositories; this slice does not add a client-selectable credential/profile identifier or weaken tenant boundaries.
- The explicit-human transition writes a durable successor checkpoint before continuing, providing observable node completion and clearing stale human failure state without deleting prior evidence.
- Explicit HUMAN resume performs no model call and no browser action for the human node itself, avoiding unnecessary compute cost. It adds only the expected durable checkpoint/run updates before successor execution.
- A concurrent duplicate human-resume command is still a residual risk at the command/orchestration boundary: `WorkflowExecutionEngine` does not provide its own compare-and-swap claim on a WAITING run. Production API/worker integration must serialize or idempotently claim human-resolution commands with the existing automation/run locking model before a side-effecting successor can execute.

### Known risks / unresolved questions
- Human branch-selection data is not yet represented as a typed durable resolution command. The current exactly-one-successor rule is intentionally conservative until that contract exists.
- Concurrent duplicate human-resume delivery needs an explicit idempotency/CAS or lease-backed command claim at the orchestration boundary; relying only on callers to avoid duplicates is not sufficient for production.
- CI install currently reports an AWS SDK peer-version warning: `@aws-sdk/lib-dynamodb` resolves a `@aws-sdk/util-dynamodb` peer expectation newer than the pinned `@aws-sdk/client-dynamodb`. This did not cause the validated lifecycle failures but should be aligned in a dependency-discipline slice rather than ignored.
- Real AgentCore Browser, browser-profile persistence, DynamoDB, and provider credential behavior remain unvalidated without cloud credentials. Existing adapters/tests remain deterministic and credential-free; no live-cloud success is claimed.

### Next highest-value tasks
1. Add an idempotent human-resolution command contract with a resolution/command ID and conditional run-state claim so duplicate/concurrent resume delivery cannot execute a side-effecting successor twice.
2. Prove worker orchestration persists browser profile/checkpoint, terminates ephemeral browser compute on pause, and reconstructs a fresh runtime on resume while maintaining the automation lock/ownership boundary.
3. Align the AWS SDK package versions deliberately and re-run the full suite, retaining pinned/controlled dependency behavior.
4. Add explicit audit/run events for human pause, human resolution acceptance/rejection, resume checkpoint, and successor start without storing hidden reasoning or sensitive browser data.
5. Continue the end-to-end lifecycle toward capture/compile/test/publish/schedule only through provider-neutral ports; keep Google adapters implementable against the same contracts.

## 2026-08-19 — Guarded human-resolution command claims

### Completed
- Added a provider-neutral `HumanResolutionCommand` contract carrying `runId`, `expectedNodeId`, `resolutionId`, and ownership scope.
- Added `HumanResolutionClaimStore` with explicit `ACCEPTED`, `REPLAY`, and `CONFLICT` outcomes. The contract requires cloud adapters to make claim creation atomic; read-then-unconditional-write implementations are explicitly invalid.
- Added `HumanResolutionCoordinator` to validate the durable run/checkpoint boundary before a resolution can be claimed: the run must exist in the requested tenant/user scope, remain `WAITING_FOR_HUMAN`, have a durable checkpoint bound to the same run/automation/workflow version, and match the expected node.
- Added an in-memory claim adapter for deterministic local/test use. It keys claims by tenant + user + run + node so a second resolution ID cannot win the same human boundary.
- Added tests for identical-delivery replay, concurrent competing resolution IDs, stale-node rejection before mutation, cross-tenant isolation, and rejection after the run has already left `WAITING_FOR_HUMAN`.
- Exported the new contract/coordinator from `@automation/core`; no AWS/GCP dependency was introduced.

### Validation
- The code increment was committed as `11f811b165a219a2a4fc68464a52ceffb7a7dafb` and pushed to PR #1.
- Local clone/test execution was attempted again, but this execution container still cannot resolve `github.com`; no local test-pass claim is made.
- GitHub Actions for the new head had not yet surfaced through the connector at the time this entry was written; latest-head CI is rechecked after this documentation commit and no green claim is made until a completed successful run is observed.

### Invariants and failure-mode review
- Only an `ACCEPTED` claim is permission for a caller to start resume execution. `REPLAY` and `CONFLICT` are non-executing outcomes.
- Claim validation is node-specific and workflow-version-specific, preventing stale human commands from silently applying to a later pause boundary or changed workflow version.
- Ownership lookup occurs before claim creation, so a cross-tenant request cannot create a claim for a run it cannot resolve.
- The in-memory adapter is atomic only within one process and exists for tests/local mode. Production durability still requires a conditional database write or equivalent transactional primitive.
- This slice deliberately does not yet wire the claim into `WorkflowExecutionEngine`; therefore it narrows the concurrency hazard but does not by itself make duplicate resume execution impossible in production.

### Security, retry, observability, cost, and scaling review
- Resolution IDs and node IDs are metadata, not secrets; no browser/session/provider credential material is added to logs or persistence contracts.
- The claim path performs metadata reads plus one atomic claim write and does not create browser/model compute, so rejected duplicates are cheap and can be absorbed before execution-plane cost is incurred.
- A conflicting command returns the already-accepted claim identity rather than accepting a second branch of execution; callers must avoid exposing that metadata across authorization boundaries.
- No retry loop was added. Adapter-level transient database failures should be retried by the orchestration layer using the same resolution ID so a retry resolves to `REPLAY` rather than a second acceptance.

### Known risks / unresolved questions
- The claim is not yet persisted by an AWS adapter, and the engine can still be called directly with `resumeFromHuman=true`; production safety therefore still depends on finishing the integration boundary.
- Crash recovery between claim acceptance and resume execution is not yet specified. The next slice should use a durable conditional claim/state transition that permits the same resolution ID to recover after worker loss without letting a competing ID execute.
- Typed human branch-selection output is still absent; explicit `HUMAN` nodes remain restricted to one successor.
- The AWS SDK peer-version warning remains unresolved.

### Next highest-value tasks
1. Implement the claim atomically in `AwsDynamoRunRepository` or a dedicated DynamoDB claim adapter and integrate resolution acceptance with the engine/worker so direct duplicate resume delivery cannot execute a side-effecting successor twice.
2. Define crash-safe replay semantics for a worker that dies after claim acceptance but before successor execution.
3. Add audit events for human pause, claim accepted/replayed/conflicted, resume checkpoint, and successor start.
4. Align AWS SDK package versions and re-run the full workspace suite.
5. Continue browser-profile pause/resume reconstruction and then move back outward through capture -> compile -> test -> publish -> schedule.

## 2026-08-19 — Durable AWS human-resolution claims

### Completed
- Added `AwsDynamoHumanResolutionClaimStore`, a dedicated AWS adapter implementing the provider-neutral `HumanResolutionClaimStore` contract without adding AWS dependencies to core.
- Human-resolution claims are keyed by the same tenant/user ownership partition plus run and paused node. The first resolution uses a conditional DynamoDB put; losing writers perform a strongly consistent read to distinguish identical `REPLAY` from competing `CONFLICT`.
- Claim payloads are validated against requested tenant, user, run, and node identity on read so a malformed/corrupted item cannot silently cross an ownership or pause boundary.
- Added AWS adapter regression coverage for first acceptance, duplicate replay, concurrent competing resolution IDs, cross-tenant isolation, strongly consistent contention reads, and propagation of non-conditional DynamoDB failures.
- Exported the new AWS adapter from the package public surface.
- Updated `ARCHITECTURE.md` and `QUALITY_GATES.md` with the durable claim guarantee, uncertainty semantics, tenant boundary, and required contention tests.

### Validation
- GitHub Actions CI run #103 completed successfully on code head `b7951c0d5c1c4429570959ca6e533ab6769dab10`; the full configured CI pipeline passed with the new adapter and tests.
- The execution container still cannot resolve `github.com`, so no local install/check/test pass is claimed.
- Documentation commits after the code head require their own latest-head CI result before this run is treated as fully validated.

### Invariants and failure-mode review
- Exactly one resolution ID can be durably accepted for a tenant + user + run + paused-node boundary even when separate workers race.
- A conditional-write loser is not allowed to guess the outcome: it uses a strongly consistent read of the winning claim before returning `REPLAY` or `CONFLICT`.
- DynamoDB throttling, transport, permission, and other non-conditional failures propagate to the caller. They are not translated into acceptance/replay/conflict because write outcome is not proven by those errors.
- The adapter validates all identifiers and timestamps before persistence and stores no browser/profile/provider secret material.
- This slice does not change retry budgets, browser timeouts, reasoning behavior, workflow topology, or effect-verification semantics.

### Security, concurrency, observability, cost, and scaling review
- Claims remain in the ownership-scoped DynamoDB partition; a different tenant/user cannot retrieve the winning resolution using the same run/node IDs.
- Claim acceptance costs one conditional write in the uncontended case. Duplicate/conflicting delivery adds one failed conditional write plus one strongly consistent read, still avoiding browser/model startup and downstream side effects.
- No new dependency was introduced; the implementation uses the already-controlled AWS SDK packages.
- Resolution IDs and node IDs are operational metadata, not secrets. No hidden reasoning, cookies, browser storage, credentials, or auth headers are persisted by the adapter.

### Known risks / unresolved questions
- The durable AWS claim is not yet wired into a production resume worker/API boundary. `WorkflowExecutionEngine` can still be invoked directly with `resumeFromHuman=true`, so duplicate execution prevention is not end-to-end complete yet.
- Crash recovery after claim acceptance but before successor execution is still unspecified. A same-resolution replay must eventually be able to recover a dead worker without permitting a competing resolution to execute.
- Explicit HUMAN branch-selection data is still absent; the exactly-one-successor rule remains intentionally conservative.
- The existing AWS SDK peer-version warning still needs deliberate package alignment.
- Real DynamoDB behavior is not live-cloud validated without credentials; deterministic command-level tests cover the conditional-write semantics used by the adapter.

### Next highest-value tasks
1. Add a provider-neutral human-resume orchestration service that consumes `HumanResolutionCoordinator` and only starts browser execution after a durable accepted claim, with explicit crash-safe same-resolution replay semantics.
2. Wire that orchestration service to the AWS worker/runtime path and prove duplicate/conflicting resolution delivery cannot start a second side-effecting successor.
3. Add structured audit events for human pause, claim accepted/replayed/conflicted, resume checkpoint, and successor start without sensitive payloads.
4. Align the AWS SDK package versions deliberately and run the full workspace CI again.
5. Continue browser-profile pause/resume reconstruction, then proceed outward through capture -> compile -> test -> publish -> schedule.
