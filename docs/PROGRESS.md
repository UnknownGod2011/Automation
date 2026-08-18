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
