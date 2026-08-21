# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains available in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work remains parked.
- Versioned capture trace contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, verification for side effects, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> schedule -> execute -> history lifecycle without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus the Next.js app provide dashboard/create/capture/compile/test/publish/history, authenticated credential settings, and schedule update/pause/resume/disable controls.
- Cognito managed login, API Gateway JWT authorization, AgentCore Live View/Profile capture, durable capture completion, immutable S3 capture/workflow documents, AgentCore Identity BYOK, OpenAI Responses reasoning, production fresh tests, SES notifications, CloudWatch telemetry, and tenant-scoped DynamoDB state are composed behind AWS adapters.
- Scheduled execution is EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard -> AgentCore Runtime. Occurrence-derived durable idempotency, automation locking, bounded retries, explicit verification, and DLQ/backpressure remain authoritative.
- AgentCore Runtime and the control-plane/capture/dispatcher Lambda artifact are deterministic Node 22 ZIP packages. Immutable release objects are create-only in versioned S3 and recorded with exact VersionIds.
- `scripts/deploy-aws-release.sh` deploys Cognito bootstrap -> AgentCore Runtime -> scheduling -> control plane/capture completion -> Cognito route finalization -> optional observability using short-lived AWS CLI credentials and immutable artifact coordinates.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `c761ff4aac60bde8ae4248423edbe194dd7e4fd7` is green on GitHub Actions CI #188.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — long-running cloud capture collection

### Product slice

The capture control surface now launches actual observation work instead of only flipping DynamoDB state. A new provider-neutral `CaptureCollectionWorker` loads the tenant-scoped automation and durable capture session, runs the existing observation-only collector, and delegates acceptance to the existing `CaptureCompletionService`. An already-completed session is treated as replay before any browser automation-stream connection is opened.

`Start recording workflow` now performs the durable `AUTH_SETUP -> WORKFLOW` transition first and then invokes a new `CaptureCollectionTaskStarter`. The production AWS starter sends only `{kind, automationId, captureSessionId}` to the configured AgentCore Runtime while `runtimeUserId` remains a separate trusted AgentCore invocation field. Tenant identity, Browser Profile refs, BYOK credentials, and workload tokens are not serialized into the task request. If Runtime invocation is uncertain, the durable WORKFLOW state is intentionally retained and repeating Start retries task launch.

The AgentCore Runtime now multiplexes a `CAPTURE_COLLECTION` workload alongside scheduled runs and fresh tests. The Node Runtime host starts capture collection as a tracked background task and immediately acknowledges the Start command instead of holding the control-plane request open. `/ping` reports `HealthyBusy` while capture collection is active so the Runtime can keep servicing health checks while the collector polls durable control state. Duplicate active launches in the same Runtime process converge on a stable tenant/user/automation/capture task identity.

The Playwright collector now reads durable control state before attaching listeners and refuses to observe before `WORKFLOW`. This closes the previous first-event race where a workflow click could be tagged `AUTH_SETUP` until the first poll. If Finish is already durable when the task starts, it skips the automation-stream connection entirely. Raw typed values remain excluded and are represented only by sensitive runtime-variable placeholders.

When Finish becomes durable, the background worker returns the trace to the same trusted Runtime composition, which uses the existing completion authority: save Browser Profile first -> persist immutable trace -> durably complete capture/latest pointer -> stop ephemeral browser. The worker composes the same DynamoDB/S3/AgentCore adapters already used elsewhere; no new recovery subsystem or provider-specific core contract was added. The separately deployed IAM-only completion endpoint remains available for external trusted workers, while the co-located AgentCore worker intentionally calls the same completion service directly to avoid an unnecessary signed HTTP hop.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Runtime scope remains deployment-owned tenant + AgentCore-provided user identity. Task JSON cannot override either.
- Start launch happens only after the authenticated control-plane service validates the current capture session and commits WORKFLOW. Cross-tenant launch is rejected before AgentCore invocation.
- Repeating Start retries an uncertain launch without rewinding control state. Same-process duplicate active Runtime tasks are suppressed; durable completed-session replay suppresses browser reconnection after completion.
- Collector launch does not introduce a browser/model retry loop. It polls only bounded DynamoDB control state and exits on Finish or session expiry.
- AgentCore Runtime already has the exact DynamoDB/S3/Browser Profile/automation-stream permissions required by capture completion; no new IAM wildcard or secret capability is required.
- Background task failures are logged with a fixed event label only; browser/provider exception text and secrets are not reflected to the user or Runtime HTTP response.
- The Runtime reports busy health while collection is active. Capture duration remains bounded by the existing durable capture expiry and Runtime max lifetime.
- Observation cost starts only when the user presses Start recording workflow, so login/authentication time in Live View does not consume Playwright collector polling/automation-stream work.

### Tests / validation

- Core tests cover collection -> completion handoff, completed-session replay without browser work, session/automation identity mismatch, task launch after durable WORKFLOW, launch retry on replay, and durable WORKFLOW retention after uncertain Runtime launch.
- AWS tests cover trusted Runtime task invocation, omission of tenant/workload secrets from task JSON, cross-tenant suppression, acknowledgement identity validation, Runtime-to-worker scope routing, WORKFLOW-first observation, no raw input retention, finish-before-connect optimization, and pre-WORKFLOW rejection.
- This section does not claim the new head green until GitHub Actions completes on the exact published SHA.

## Next product milestones

1. Add automatic capture-readiness polling in the authenticated Next.js automation page so Finish transitions to `latestCapture` / Compile-ready without manual refresh, with a bounded interval and no Live View/browser identifiers stored client-side.
2. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs release + deploy without retaining ZIP artifacts in GitHub Actions storage.
3. Perform one controlled real AWS demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
4. Close only defects exposed by that vertical demo (including collector replacement-worker recovery if it proves necessary); do not return to speculative recovery micro-hardening.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Capture-task duplicate suppression is process-local while the durable completed-session boundary is global. If a Runtime process is replaced mid-recording, the controlled AWS demo should determine whether a small durable collector claim is required; do not add it speculatively before evidence.
- A background collector failure currently leaves WORKFLOW/finish state durable for user-visible retry/expiry rather than manufacturing a trace. A later UX/status slice should surface this explicitly if the real demo shows it is confusing.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
