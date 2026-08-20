# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains available in Git history; this checkpoint intentionally emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, verification for side effects, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> schedule -> execute -> history lifecycle without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus the Next.js app provide dashboard/create/capture/compile/test/publish/history and authenticated credential settings.
- Cognito managed login uses authorization-code + PKCE; API Gateway-verified access-token claims become the trusted user boundary while tenant identity remains deployment-owned.
- AgentCore Live View capture restores a server-owned Browser Profile. Durable capture completion saves profile state before accepting immutable captured trace data. Capture trace metadata is tenant-scoped in DynamoDB while full validated traces and workflow versions are immutable S3 documents.
- AgentCore Identity-backed BYOK keeps plaintext provider keys out of ordinary tables. The credential pool is deterministic, tenant-scoped, sanitized, and wired to real OpenAI Responses API reasoning through runtime-only secret retrieval.
- Production fresh tests use AgentCore Runtime and the same hardened browser/BYOK execution plane as scheduled runs; configured cloud deployments cannot silently fall back to browser/model execution in API Lambda.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard -> AgentCore Runtime provides buffered at-least-once scheduling with occurrence-derived durable idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- Scheduled execution composes DynamoDB run/checkpoint/lock state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, SES notifications, CloudWatch EMF telemetry, and trusted Cognito email lookup.
- AgentCore Runtime is packageable as a Node 22 direct-code ZIP and provisioned by `infra/aws/agentcore-runtime.yaml` with a bounded worker role.
- `createAwsControlPlaneBootstrap` composes the production control-plane graph from DynamoDB/S3 persistence, AgentCore Browser/Profile capture, AgentCore Identity credential management, AgentCore Runtime fresh testing, EventBridge Scheduler, Cognito-authenticated HTTP transport, and a separate trusted capture-completion handler.
- The control-plane Lambda is packageable as a Node 22 ZIP and provisioned by `infra/aws/control-plane-service.yaml` with bounded concurrency and least-privilege control-plane IAM.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `f24fdbf00af0eee92220dc6a81183e7761dfb33f` is green on GitHub Actions CI #177.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — provider-neutral automation schedule lifecycle

### Product slice

Added the domain boundary needed for users to manage a published automation after first publish without deleting workflow versions, Browser Profile state, or run history. `AutomationScheduleLifecycleService` supports recurrence/timezone updates plus explicit pause, resume, and disable commands against the existing provider-neutral `SchedulerPort`.

The transition ordering is intentionally fail-closed across the durable automation record and the external scheduler, which cannot be atomically transacted together:

- **Pause/disable:** persist `PAUSED`/`DISABLED` first, then disable the schedule. If Scheduler mutation is unavailable or uncertain, a stale schedule delivery still reaches execution preflight against a non-`ACTIVE` durable automation and cannot start Browser/model work.
- **Resume:** enable the schedule first, then advertise the automation as `ACTIVE`. A delivery racing that boundary can be skipped while the durable record is still `PAUSED`, but cannot execute prematurely.
- **Recurrence update:** update Scheduler first, then persist the new schedule metadata. Scheduler failure therefore leaves the durable automation advertising its previous schedule instead of a schedule that was never installed. Updating a paused automation preserves `enabled: false`.
- **Disable:** retains the Scheduler resource in disabled state and preserves the immutable published workflow version, stored recurrence, Browser Profile reference, and history. Repeated disable is idempotent at the domain boundary.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- All mutations resolve the automation through the existing tenant + user scoped repository; cross-tenant identifiers are rejected before Scheduler mutation.
- Pause/disable are safe under stale at-least-once delivery because durable automation status remains execution authority in scheduled-run preflight.
- Resume can lose one occurrence in a narrow race, but the chosen ordering prefers omission over an unauthorized/early browser side effect. The user can retry resume safely if Scheduler enablement fails before the durable state changes.
- No retry loop is added around Scheduler mutations. Transport uncertainty is surfaced to the caller; it is never guessed as success.
- No new dependency, cloud resource, browser/model invocation, evidence artifact, or metric dimension is introduced. Scheduler update cost is one control-plane mutation per lifecycle command.
- The external Scheduler and durable automation record remain separate authorities, so partial failures may require a future reconciliation/status repair command. The current ordering is designed so such drift fails closed for execution rather than enabling duplicate side effects.

### Tests / validation

Regression coverage proves ACTIVE and PAUSED recurrence edits, pause/resume failure ordering, disable without destructive cleanup, repeated-disable behavior, tenant isolation, invalid state transitions, and invalid IANA timezone rejection.

This implementation, tests, export, and progress checkpoint are published as one atomic multi-file Git-data commit. Exact-head GitHub Actions is authoritative; this section does not claim the new head green until that run completes.

## Next product milestones

1. Expose schedule update/pause/resume/disable through `AutomationControlPlaneService` + HTTP contracts + authenticated Next.js automation detail UX, and compose `AutomationScheduleLifecycleService` into the AWS control-plane bootstrap so these commands operate the concrete EventBridge Scheduler adapter.
2. Add a deployment/release command that uploads both tested ZIPs to versioned S3 objects and wires the resulting object versions/stack outputs without embedding cloud credentials in CI.
3. Close the trusted capture-completion deployment route: a deployment-authenticated worker/API boundary must invoke the already-separated completion handler without exposing it through the ordinary Cognito end-user route.
4. If real fresh tests commonly exceed the API Gateway request window, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; the new lifecycle ordering fails closed, but a future reconciliation/status-repair path should make any partial drift visible and repairable.
- Trusted capture-completion worker authentication is not yet provisioned as a deployment resource.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
