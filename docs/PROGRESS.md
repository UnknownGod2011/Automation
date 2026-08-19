# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, and tenant ownership.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit `HUMAN` pause -> repair -> resume lifecycle with immutable workflow-version pinning and no guessed human branching.
- Atomic human-resolution claims, durable execution leases, heartbeat fencing, redacted audit history, and AWS conditional persistence.
- Durable first-successor effect reconciliation with stable effect identity and immutable `ALREADY_APPLIED` / `DEFINITELY_NOT_APPLIED` / `AMBIGUOUS` authority.
- Provider-neutral read-only reconciliation coordinator plus AWS observation-only Playwright verifier.
- Pure `planAlreadyAppliedHumanResumeRecovery`, lease-owned atomic recovery transition, durable continuation handoff, recovery admission, and heartbeat-fenced observation-only recovery worker.
- Recovery micro-hardening is intentionally parked unless an end-to-end slice or CI exposes a concrete correctness defect.

## Build reproducibility status

- Root TypeScript and Vitest are pinned to the exact validated versions: `typescript@5.9.3` and `vitest@3.2.7`.
- Direct `@aws-sdk/client-dynamodb` is aligned to `3.1111.0`, resolving the concrete util-dynamodb peer mismatch rather than suppressing it.
- CI runs Node `22.23.2`; the repository engine floor is `>=22.12.0`, matching the resolved Vite requirement.
- CI materializes the exact pnpm 10.15.0 lock snapshot captured by CI #127 from its immutable job log, validates the snapshot, and installs with `pnpm install --frozen-lockfile`. This is deterministic but remains a bootstrap strategy; a conventional checked-in `pnpm-lock.yaml` is still preferable once the development runtime can materialize it directly.
- CI #128 passed on `60bee7e9c2bd9592f66d3449df3c181ecc2e7723` with install, `pnpm check`, and `pnpm test` all green. That SHA is the authoritative incoming baseline for the capture/compiler work.

## 2026-08-19 — Capture trace contracts and workflow compiler

### Product slice

This run moves outward from recovery into the create -> capture -> compile lifecycle. It introduces provider-neutral capture contracts and a deterministic first compiler that emits the existing semantic `WorkflowGraph` rather than generated Playwright code.

### Capture contracts

- Added a versioned `CaptureTrace` owned by tenant + user + automation and tied to a server-resolved browser profile reference.
- Events carry contiguous ordering, timestamps, page identity, bounded semantic target metadata, optional protected artifact references, explicit expected-effect verification, and an `AUTH_SETUP` vs `WORKFLOW` purpose boundary.
- Authentication setup activity may remain in the capture trace for product/audit context but is excluded from executable workflow compilation. This prevents demonstrated login/password entry from becoming a scheduled replay step.
- Input values are closed to two forms: explicitly non-sensitive `PUBLIC_LITERAL` data or `RUNTIME_VARIABLE` placeholders. Sensitive values therefore do not need to enter the workflow graph or normal metadata.
- Capture validation rejects invalid HTTP(S) URLs, duplicate event IDs, non-contiguous sequence numbers, timestamp drift outside the trace window, missing targets for actionable events, and malformed input/artifact metadata.

### Provider-neutral compiler

- Added `compileCaptureTrace`, which accepts a validated trace plus immutable workflow ID/version/time and emits the existing `WorkflowGraph` contract.
- `NAVIGATION` compiles to deterministic `NAVIGATE`; `CLICK` and `SUBMIT` compile to deterministic `CLICK`; `INPUT` compiles to `TYPE`; `SCROLL` remains capture evidence but is intentionally omitted as execution noise.
- Semantic target strategies are ranked deterministic-first: test ID, role/name, text, CSS, XPath. This aligns with the current Playwright executor and leaves semantic/model recovery as fallback.
- Every compiled side-effecting action requires a verification contract. Navigation can infer a URL verification from its captured destination; click/type/submit fail compilation if capture did not record an expected effect.
- Compiler retry budgets are bounded and use the existing failure taxonomy. Compiled actions escalate to human or constrained semantic recovery rather than broadening control flow.
- Explicitly non-sensitive captured literals are stored in optional graph `initialVariables`; sensitive/runtime inputs remain unresolved variable bindings. The next local vertical-slice service must seed these defaults plus authorized runtime variables into fresh execution state before invoking the engine.
- Auth-setup events and scroll noise do not appear in the resulting graph, and compiler tests assert that auth variable identifiers are absent from serialized workflow output.

### Tests added

Realistic fixture coverage includes auth setup, navigation, deterministic target selection, public literal typing, submit verification, and scroll noise. Negative coverage includes sensitive runtime-variable handling, missing expected effects, and trace sequence drift.

### Security / tenancy / idempotency / side effects

- Capture and compiler contracts are provider-neutral; no AWS/GCP SDK type is introduced into core workflow representation.
- Ownership identity exists on the capture boundary from the first schema. Artifact/profile references remain opaque server-side identifiers; the compiler never fetches arbitrary client-selected secrets or profiles.
- Raw login credentials are not representable as compiled auth steps through the `AUTH_SETUP` boundary; future capture adapters must mark password/MFA/security-control interaction as auth setup and/or sensitive runtime data and must never persist secret field contents in screenshots/DOM artifacts.
- Compilation is pure and deterministic for the same validated request; it performs no browser/model/network side effect and creates no concurrency race.
- Side-effect execution safety remains enforced by the existing workflow verification contract and bounded retry/human escalation rules.

### Cost / observability / recovery review

- This slice adds no cloud resources or runtime model/browser calls, so direct cloud cost is unchanged.
- Trace artifact payloads remain references rather than embedded binary/DOM data, keeping the core graph bounded. Retention/lifecycle policy for screenshots/recordings remains a later S3/control-plane concern.
- Stable trace/event/workflow IDs provide future correlation points from capture -> compile -> test/run history.
- If capture evidence is incomplete, compilation fails before publish rather than guessing a dangerous action. The user recovery path is to recapture/correct the demonstration, not to silently weaken verification.

### Validation status

- Incoming head `60bee7e9c2bd9592f66d3449df3c181ecc2e7723` is green via CI #128.
- The capture/compiler change is not considered validated until GitHub Actions completes install, `pnpm check`, and `pnpm test` successfully on the exact new head. No local pass is claimed because the development container has no authenticated GitHub/npm runtime.

## Next product milestones

1. Build the local/mock vertical slice: automation draft -> persisted capture fixture -> compile -> seed graph initial/runtime variables -> fresh test execution -> approve/publish -> scheduled occurrence dispatch -> execution -> run history, all without cloud credentials.
2. While doing that, make fresh execution consume compiled initial variables through an explicit control-plane/test-run boundary rather than hidden global state; add tenant/idempotency tests around creation, publishing, and dispatch.
3. Add control-plane service/API contracts and a minimal Next.js dashboard/create-automation/capture/test/publish UX.
4. Add AWS scheduling/dispatch adapters and IaC, then real AgentCore Live View/capture integration behind existing ports.
5. Implement BYOK credential-pool routing, notifications/observability, and one controlled human-recovery demo.

## Known parked limitations

- The current recovery continuation record is a durable handoff, not action authority. A future continuation consumer must remain idempotent before automatic post-reconstruction execution is enabled. `AMBIGUOUS` remains human-attention only, and `DEFINITELY_NOT_APPLIED` remains non-executable until an explicit proof-of-absence/idempotency contract exists.
- Graph `initialVariables` are compiler output only in this slice; fresh-run orchestration does not yet seed them automatically. That integration is explicitly part of the next local/mock vertical slice and must be tested before claiming capture -> execution end-to-end completion.
