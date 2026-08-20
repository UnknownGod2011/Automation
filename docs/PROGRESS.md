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
- Incoming head `1e28013839515d684b3e5a5aa9bf8017ef26f83d` is green on GitHub Actions CI #179.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — schedule lifecycle product/API/UX wiring

### Product slice

The already-validated provider-neutral `AutomationScheduleLifecycleService` is now surfaced through the actual product boundary instead of remaining domain-only. `AutomationControlPlaneService` exposes recurrence/timezone update plus pause/resume/disable commands, `AutomationControlPlaneHttpHandler` exposes authenticated `/schedule`, `/pause`, `/resume`, and `/disable` routes, and the Next.js automation detail page exposes matching controls for published automations.

The production AWS control-plane bootstrap now composes `AutomationScheduleLifecycleService` with the same concrete `AwsEventBridgeSchedulerAdapter` used by initial publish. Schedule edits and pause/resume/disable therefore mutate the real EventBridge Scheduler resource through the existing fail-closed domain ordering; no duplicate scheduling implementation was introduced.

The UX keeps lifecycle semantics explicit:

- ACTIVE automations may edit recurrence/timezone, pause, or disable.
- PAUSED automations may edit recurrence/timezone without re-enabling the schedule, resume, or disable.
- DISABLED automations remain inspectable with workflow/run history preserved; this slice does not silently treat disable as pause.
- UI request bodies never carry tenant/user authority. The Next.js server forwards the request-scoped Cognito access token and the control plane derives ownership from its authenticated context.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Ownership remains tenant + user scoped in the control plane and the schedule lifecycle service. Spoofed tenant/user fields in HTTP request bodies are ignored because authorization comes only from trusted authenticated context.
- Pause/disable still persist the non-ACTIVE durable automation state before disabling Scheduler, so stale at-least-once deliveries cannot begin browser/model execution. Resume still enables Scheduler before persisting ACTIVE, preferring a potentially missed occurrence over premature execution.
- Recurrence update still mutates Scheduler before advertising new durable schedule metadata and preserves `enabled: false` for paused automations.
- The web/control-plane layers add no retry loop around Scheduler. AWS transport uncertainty remains visible as a failed command rather than guessed success.
- No new dependency, IAM permission, cloud resource, browser/model invocation, evidence artifact, metric dimension, or secret-bearing field is introduced. Cost remains one Scheduler control-plane mutation per lifecycle action plus normal API/Lambda request cost.
- The existing DynamoDB <-> Scheduler cross-system partial-failure limitation remains. The domain ordering fails closed for execution, but a future reconciliation/status-repair operation should make drift inspectable and repairable.

### Tests / validation

Regression coverage now proves that schedule lifecycle commands route through trusted ownership scope, returned automation summaries remain sanitized, HTTP request-body ownership spoofing cannot override authenticated scope, and the authenticated web client targets the intended lifecycle endpoints. Existing schedule-domain tests continue to cover pause/resume failure ordering, paused recurrence edits, disable idempotency, tenant isolation, and timezone validation.

This implementation, tests, AWS composition, UX, and progress checkpoint are published as one coherent multi-file Git-data commit. No dependency manifest changed. Exact-head GitHub Actions remains authoritative; this section does not claim the new head green until CI completes successfully.

## Next product milestones

1. Add a deployment/release command that uploads both tested ZIPs to versioned S3 objects and wires the resulting object versions/stack outputs without embedding cloud credentials in CI.
2. Close the trusted capture-completion deployment route: a deployment-authenticated worker/API boundary must invoke the already-separated completion handler without exposing it through the ordinary Cognito end-user route.
3. If real fresh tests commonly exceed the API Gateway request window, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Trusted capture-completion worker authentication is not yet provisioned as a deployment resource.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
