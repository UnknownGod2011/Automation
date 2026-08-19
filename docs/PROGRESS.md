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
- Build inputs are pinned to the validated TypeScript/Vitest/AWS SDK versions. CI uses Node 22.23.2 and a frozen pnpm 10.15.0 dependency snapshot; the checked-in-lockfile shape remains preferable when the connector runtime can materialize it directly.
- Capture contracts distinguish `AUTH_SETUP` from executable `WORKFLOW` events and keep authentication setup out of scheduled workflow compilation.
- `compileCaptureTrace` emits the semantic `WorkflowGraph`, ranks deterministic selectors first, requires verification for side effects, omits scroll noise, synthesizes a fresh-run navigation when capture begins on an already-open page, and emits non-sensitive public literals as graph `initialVariables`.

## Authoritative incoming validation

- CI #129 passed on `776dd184eceea91685561701636aabb428cae76e` with deterministic install, `pnpm check`, and `pnpm test` all successful.
- PR #1 remains the development PR on `agent/bootstrap-platform`.

## 2026-08-19 — Local/mock product lifecycle vertical slice

### Product slice

This run proves the product contracts outward from capture rather than adding another recovery edge case. A provider-neutral `AutomationProductLifecycleService` now composes the existing repositories, compiler, execution engine, scheduler port, occurrence coordinator, and in-memory browser-profile/lock state into a local/mock lifecycle that requires no cloud credentials.

The covered lifecycle is:

create draft -> create isolated browser-profile reference -> persist capture trace -> compile immutable workflow version -> seed fresh-run variables -> execute a fresh test -> mark ready to publish -> publish schedule/version -> dispatch a scheduled occurrence -> execute -> inspect run history.

### New lifecycle boundary

- Draft creation validates HTTP(S) target URL, requires explicit authorization/consent, creates the server-owned browser-profile reference, and writes a tenant/user-owned `AutomationRecord`.
- Capture persistence is immutable by trace ID and validates tenant/user/automation identity, objective, website, and exact server-owned browser profile before storing the trace.
- Compilation reads the persisted trace, allocates the next immutable workflow version, invokes `compileCaptureTrace`, persists the graph, and moves the automation to `READY_TO_TEST`.
- Fresh tests are durable `RunRecord`s. Duplicate test-run IDs/occurrence keys return the existing run rather than executing twice.
- Fresh-run variable seeding is now explicit at the lifecycle boundary: graph `initialVariables` are merged with caller-supplied runtime variables into the first checkpoint before the execution engine starts. Runtime values are not added to the compiled graph.
- A successful fresh test moves the automation to `READY_TO_PUBLISH`. Publish is rejected before a successful test and may publish only the latest tested workflow version.
- Publish validates the IANA timezone, writes the schedule through `SchedulerPort`, and then marks the automation `ACTIVE` with its immutable published workflow version.
- Scheduled dispatch reuses `ScheduledRunCoordinator`, so duplicate schedule delivery is suppressed by the existing automation+scheduled-occurrence idempotency key before browser effects execute.
- Run history is read through the existing tenant-scoped `RunRepository`.

### Local/mock adapters and tests

- Added `CaptureTraceRepository` plus `InMemoryCaptureTraceRepository` with immutable, tenant-scoped capture storage.
- Added deterministic end-to-end fixture coverage with an auth-setup password event, a fresh-page synthetic navigation, deterministic click/type/submit actions, a compiled public literal, a non-sensitive runtime variable, explicit verification, publish, scheduled execution, duplicate delivery suppression, and run history.
- Tests assert that auth variable identifiers and runtime values do not appear in the compiled graph, while the first durable checkpoint contains the merged public/runtime values needed by execution.
- Negative coverage includes missing consent, immutable capture replacement, cross-tenant access, publish-before-test rejection, and invalid IANA timezone rejection.

### Correctness / security / tenant isolation

- Core remains provider-neutral; this slice introduces no AWS/GCP SDK types or new dependency.
- Browser-profile references are created and resolved server-side through the existing profile port. A capture cannot substitute another profile reference.
- Capture ownership and automation ownership must match tenant + user + automation before compilation.
- Authentication-setup secret values remain absent from the compiled workflow. The local fixture uses a non-sensitive runtime variable for execution; secret/BYOK material still belongs behind the later credential-vault boundary rather than normal metadata.
- Side-effect success is still determined by the existing verification engine, not by attempted browser actions.
- Test and scheduled execution use durable run/checkpoint records. Duplicate scheduled delivery reaches `DUPLICATE` before execution and therefore cannot repeat browser effects.
- Publish ordering is fail-closed: the schedule is registered before the automation is marked `ACTIVE`, so a control-plane write failure cannot leave an active automation with no schedule registration.

### Concurrency / retry / timeout / cost / observability / recovery review

- The scheduled path keeps the existing automation lock and occurrence idempotency behavior. This mock slice does not add a second concurrency mechanism.
- Execution continues to use the existing bounded retry/fingerprint/human-escalation engine. Tests use deterministic no-delay jitter so the fixture is stable.
- No cloud browser/model/SQS/Step Functions resource is created here, so direct cloud cost is unchanged.
- Stable automation, capture, workflow, run, and occurrence IDs now connect the local product lifecycle and are ready to become API/telemetry correlation fields.
- The local scheduled path intentionally uses the provider-neutral browser executor directly instead of creating an ephemeral cloud browser session. Real profile restore/save and AgentCore session lifecycle remain the AWS integration milestone; this local slice proves control-plane contracts, not cloud-session behavior.
- Recovery behavior is unchanged. Existing bounded failure/human takeover remains available to the execution engine; no new recovery authority was added.

### Validation status

- Incoming head `776dd184eceea91685561701636aabb428cae76e` is green via CI #129.
- The new vertical-slice head is not considered validated until GitHub Actions completes install, `pnpm check`, and `pnpm test` successfully on that exact SHA. No green claim should be made before that run exists.

## Next product milestones

1. Add provider-neutral control-plane request/response service contracts suitable for HTTP APIs, then expose the lifecycle through minimal API handlers.
2. Add a minimal Next.js dashboard/create-automation/capture/test/publish UI using those contracts; missing auth/cloud configuration must render explicit `NOT_CONFIGURED` states rather than break builds.
3. Add AWS scheduling/dispatch adapters and IaC (EventBridge Scheduler + SQS + durable orchestration), preserving occurrence idempotency and queue backpressure.
4. Wire AgentCore Live View/capture and real browser-profile restore/save behind the existing capture/browser ports.
5. Implement BYOK credential-pool routing through the secure secret boundary, then notifications/observability and one controlled human-recovery demo.

## Known parked limitations

- The recovery continuation record remains a durable handoff, not execution authority; further recovery continuation consumption stays parked until the end-to-end cloud worker needs it.
- Runtime variables are supplied explicitly to fresh-test/scheduled dispatch in this local slice and seeded into durable checkpoint variables. Sensitive runtime values require the later credential/secret-resolution contract; do not place provider keys, passwords, cookies, or equivalent secrets in this map.
- Workflow publication is represented by the automation's immutable `publishedWorkflowVersion` pointer; the already-persisted tested graph is not rewritten merely to add `publishedAt`.
- The local/mock scheduled path does not restore/save a real browser profile or create cloud browser compute. Those semantics remain in the existing production worker/AWS adapter path and must be exercised when cloud integration is wired.
