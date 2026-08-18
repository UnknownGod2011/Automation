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
