# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, tenant ownership, and in-memory adapters.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit `HUMAN` pause -> repair -> resume lifecycle with immutable workflow-version pinning, conditional human-resolution claims, durable execution leases, heartbeat fencing, redacted audit history, and read-only crash reconciliation.
- Recovery micro-hardening is intentionally parked unless an end-to-end slice or CI exposes a concrete correctness defect.
- Build inputs are pinned to the validated TypeScript/Vitest/AWS SDK versions. CI uses Node 22.23.2 and pnpm 10.15.0, regenerates the dependency lock snapshot locally with package scripts disabled, checks its exact reviewed SHA-256, and only then performs a frozen install. CI no longer depends on retention of an old Actions job log.
- Capture contracts distinguish `AUTH_SETUP` from executable `WORKFLOW` events and keep authentication setup out of scheduled workflow compilation.
- `compileCaptureTrace` emits the semantic `WorkflowGraph`, ranks deterministic selectors first, requires verification for side effects, omits scroll noise, synthesizes a fresh-run navigation when capture begins on an already-open page, and emits non-sensitive public literals as graph `initialVariables`.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history lifecycle without cloud credentials.
- `AutomationControlPlaneService` and `AutomationControlPlaneHttpHandler` expose the lifecycle through sanitized provider-neutral dashboard/API contracts with explicit configured/local/mock/not-configured capability states.

## Authoritative incoming validation

- CI #131 passed on `4f3411c367c99d404afd87521ebc78482f08996c` with the pinned lock snapshot SHA `8b113df1513958078cf6504f527ad6f4916247d95b6205e4927153f00754aece`, frozen install, `pnpm check`, and `pnpm test` all successful.
- PR #1 remains the development PR on `agent/bootstrap-platform`.

## 2026-08-19 — Local/mock product lifecycle vertical slice

A provider-neutral `AutomationProductLifecycleService` composes repositories, compiler, execution engine, scheduler port, occurrence coordinator, browser profile state, and lock state into a local/mock lifecycle requiring no cloud credentials.

The covered lifecycle is create draft -> create isolated browser-profile reference -> persist capture trace -> compile immutable workflow version -> seed fresh-run variables -> execute a fresh test -> mark ready to publish -> publish schedule/version -> dispatch a scheduled occurrence -> execute -> inspect run history.

Key guarantees:
- explicit authorization/consent is required before draft creation;
- capture ownership, objective, website, and server-owned browser-profile identity must match the automation;
- authentication setup values do not enter compiled workflows;
- graph `initialVariables` plus authorized runtime variables seed the first durable checkpoint;
- publish requires the latest successfully tested workflow version and a valid IANA timezone;
- duplicate scheduled delivery is suppressed by occurrence idempotency before browser effects execute;
- run/checkpoint state remains durable and execution success remains verification-based.

## 2026-08-19 — Control-plane service and HTTP contract boundary

### Product slice

The local lifecycle is now exposed through a provider-neutral control-plane service and minimal HTTP transport contract suitable for a Next.js UI or API Gateway/Lambda adapter. This is deliberately transport/auth-provider neutral: Cognito/Next.js-specific types are not introduced into core.

### API and dashboard contracts

- Added `AutomationControlPlaneService` with dashboard, automation detail/create, capture start, trusted capture ingestion, compile, fresh-test, publish, and run-history operations.
- Added sanitized dashboard/run response DTOs. Server-owned `browserProfileRef` is intentionally absent, providing a stable rule for future credential/profile references: control-plane clients receive product state, not execution capabilities.
- Dashboard responses include explicit capability states (`CONFIGURED`, `LOCAL_MOCK`, `NOT_CONFIGURED`) for auth, capture, cloud execution, scheduling, and notifications. Missing cloud credentials can therefore render a product state instead of breaking imports/builds or pretending production integration exists.
- `CaptureSessionStarter` is an explicit port. Until AgentCore Live View is wired, the UI/API can receive a deterministic `NOT_CONFIGURED` response rather than a fake live-view URL.
- Attention state is derived from automation attention statuses and a latest run waiting for human intervention.

### HTTP boundary and security

- Added `AutomationControlPlaneHttpHandler` with `/v1/automations` create/list, detail, capture start, trusted trace ingestion, compile, test, publish, and run-history routes.
- Tenant/user ownership comes exclusively from `AuthenticatedControlPlaneContext`; request JSON is never allowed to select tenant or user scope. This is the boundary Cognito/API middleware must populate later.
- Unexpected internal/domain errors are returned as fixed sanitized error responses rather than echoing provider exceptions or secret-bearing text.
- Schedule shape and basic request types are validated before lifecycle mutation.
- Runtime variables may enter the test command but are never echoed by these response DTOs. Sensitive runtime/provider credentials remain out of scope until the secure vault/BYOK boundary exists.

### Correctness / idempotency / concurrency / retry / cost / observability review

- This slice adds no browser/model/cloud resource and no new dependency, so execution cost and queue behavior are unchanged.
- Existing lifecycle occurrence idempotency, execution locks, bounded retries, effect verification, checkpointing, and human recovery are reused rather than duplicated in the HTTP layer.
- Duplicate automation IDs are rejected before lifecycle side effects. A future public API should add a durable request-idempotency key if clients require safe POST replay across network uncertainty; this slice does not claim generic HTTP command idempotency.
- Stable automation/run/workflow identifiers remain the correlation fields for later API Gateway/CloudWatch tracing.
- Capture ingestion is intentionally treated as a trusted capture-plane callback shape. The public browser UI should not be allowed to manufacture arbitrary server-owned profile references; AgentCore capture wiring must authenticate this callback and continue server-side profile resolution.

### Tests

- Added coverage proving dashboard payloads never expose browser-profile references.
- Added cross-tenant read isolation at the control-plane service boundary.
- Added explicit `NOT_CONFIGURED` capture behavior.
- Added duplicate-create suppression before lifecycle work.
- Added an HTTP spoofing regression proving tenant/user fields in request JSON cannot override authenticated scope.
- Added fixed-error sanitization and invalid-schedule rejection tests.

### Validation status

- Incoming head `8c1c6939262e820a0d21e436f45aacf28fcb3373` is green via CI #130.
- Control-plane head `4f3411c367c99d404afd87521ebc78482f08996c` is green via CI #131.

## 2026-08-19 — Deterministic lock bootstrap without Actions-log retention

### Build-reproducibility slice

The temporary CI bootstrap that reconstructed `pnpm-lock.yaml` from retained GitHub Actions job `96040770342` has been removed. `scripts/materialize-pnpm-lock.sh` now recreates the lock from the workspace manifests using the pinned pnpm `10.15.0`, with lifecycle scripts disabled, and requires the generated file to match the exact previously validated SHA-256 `8b113df1513958078cf6504f527ad6f4916247d95b6205e4927153f00754aece` before installation proceeds.

CI then executes `pnpm install --frozen-lockfile`. A resolver change, manifest drift, pnpm-version drift, or intentional dependency update therefore fails before type checking/tests until the new dependency graph has been reviewed and the pinned snapshot hash is deliberately updated.

The previously-fixed AWS SDK alignment is guarded explicitly: the generated snapshot must retain `@aws-sdk/client-dynamodb` `3.1111.0` and the compatible `@aws-sdk/util-dynamodb` peer resolution `3.1103.0(@aws-sdk/client-dynamodb@3.1111.0)`.

### Security / reliability / cost review

- CI no longer needs `actions: read`, a GitHub API bearer token, or continued retention of a historical job log merely to install dependencies; `contents: read` is sufficient.
- Lock resolution runs with package lifecycle scripts disabled, reducing install-time code execution before the dependency graph has been authenticated by hash.
- The frozen install still enforces manifest/lock agreement and package integrity after the hash gate.
- This change creates no browser/model/cloud execution resources and does not affect tenant data, retries, schedule delivery, side-effect verification, or recovery behavior.
- Registry availability is still required to regenerate/install dependencies. If the registry later resolves a different graph, CI fails closed rather than silently accepting the drift.
- A conventional checked-in `pnpm-lock.yaml` remains a reasonable future simplification when the development environment can transfer/generated-file contents directly. The hash-gated regeneration strategy is deterministic and no longer tied to ephemeral Actions retention.

### Validation status

- Incoming head `4f3411c367c99d404afd87521ebc78482f08996c` is green via CI #131 and independently confirms the expected lock SHA plus full test suite.
- This build-reproducibility change is not considered validated until GitHub Actions successfully regenerates that exact snapshot, completes the frozen install, `pnpm check`, and `pnpm test` on the exact new commit.

## Next product milestones

1. Add the minimal Next.js dashboard/create-automation/capture/test/publish UX against the existing control-plane contracts. Dependency additions must intentionally update the reviewed lock snapshot/hash; missing auth/capture/cloud integrations must render `NOT_CONFIGURED` rather than fake success.
2. Add AWS scheduling/dispatch adapters and IaC (EventBridge Scheduler + SQS + durable orchestration or a justified equivalent), preserving occurrence idempotency, lock semantics, queue backpressure, timezones, and bounded retry behavior.
3. Wire AgentCore Live View/capture and real browser-profile restore/save behind `CaptureSessionStarter` and the existing browser/profile ports.
4. Implement BYOK credential-pool routing through the secure secret boundary, keeping provider keys out of normal metadata tables and logs.
5. Add notifications/observability and one controlled human-recovery demo across the complete product lifecycle.

## Known parked limitations

- The recovery continuation record remains a durable handoff, not execution authority; further recovery continuation consumption stays parked until the end-to-end cloud worker needs it.
- Runtime variables are supplied explicitly to fresh-test/scheduled dispatch and seeded into durable checkpoint variables. Sensitive runtime values require the later credential/secret-resolution contract; do not place provider keys, passwords, cookies, or equivalent secrets in this map.
- Workflow publication is represented by the automation's immutable `publishedWorkflowVersion` pointer; the already-persisted tested graph is not rewritten merely to add `publishedAt`.
- The local/mock scheduled path does not restore/save a real browser profile or create cloud browser compute. Those semantics remain in the existing production worker/AWS adapter path and must be exercised when cloud integration is wired.
- The control-plane HTTP adapter is framework-neutral. Cognito token verification, API Gateway/Lambda wiring, CSRF/origin policy for browser clients, rate limiting, and the actual Next.js UI remain the next control-plane implementation slice.
