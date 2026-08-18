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
- GitHub Actions is now the authoritative validation path until a network-capable local checkout is available.

### Architectural decisions locked
- Durable orchestration state belongs outside the model/browser runtime.
- Workflow IR is semantic/versioned, not generated one-off Playwright source.
- Deterministic execution precedes semantic/model fallback.
- Every consequential node has bounded retries and effect verification.
- Human takeover closes ephemeral browser compute and resumes from persisted checkpoint/profile later.
- BYOK secrets stay behind a secret/token-vault adapter; normal tables hold references/health metadata only.
- Multi-tenant ownership/idempotency/concurrency fields exist from the first schema.

### Next highest-value tasks
1. Add repository/service interfaces for Automations, WorkflowVersions, Runs, Checkpoints, Locks, ArtifactStore, BrowserProfiles, CredentialVault, Scheduler, Notifications, and ReasoningProvider.
2. Implement deterministic in-memory adapters and tests so the full lifecycle is locally executable without AWS keys.
3. Build the workflow execution engine/state reducer with retry fingerprints, verification, pause/resume, and idempotent checkpoints.
4. Add a mock browser executor and a semantic fallback interface; prove a complete scheduled run in tests.
5. Add AWS infrastructure-as-code skeleton and environment contracts without requiring credentials at build time.
6. Add Next.js control-plane UI only after lifecycle/domain APIs are stable enough not to encode temporary assumptions.

### Current blockers
- No AWS credentials/API keys are required for current development. Real cloud integration tests will remain disabled until credentials exist.
- Container network could not reach GitHub during this run; repository CI covers validation.
