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
- Incoming head `976f1736b61d69d16ce58a066a9cb6ef87bc9bd2` is green on GitHub Actions CI #187.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — capture recording control reaches the product surface

### Product slice

The durable `AUTH_SETUP -> WORKFLOW -> finish` control state is now composed into the production AWS control plane rather than existing as an isolated adapter. `AgentCoreCaptureSessionStarter` receives the production control store, so every new cloud capture creates both durable capture-session metadata and its recording-control state.

A new provider-neutral `CaptureRecordingControlPlaneService` exposes only the current capture's opaque session ID, phase, finish-request bit, and expiry. Browser session IDs, Browser Profile references, cookies, typed values, Live View credentials, BYOK material, and workload tokens remain server-side. The service verifies the tenant/user/automation boundary and requires recording commands to target the current active capture before changing state.

`CaptureAwareControlPlaneHttpHandler` adds authenticated `GET /v1/automations/:id/capture-recording`, `POST .../start`, and `POST .../finish` routes while delegating the existing API unchanged. Request JSON cannot override authenticated ownership. The Next.js server client and automation detail page now surface Start recording workflow / Finish capture controls. Returning from Live View and refreshing the automation page reconstructs control state from DynamoDB; the user does not manually copy a capture identifier.

`AwsDynamoCaptureSessionStore` now writes a tenant-scoped current-capture pointer atomically with STARTED session metadata. This makes active-capture lookup bounded and strongly consistent instead of scanning a tenant partition. Completion remains authoritative through the existing immutable trace/profile-save path; a pointer that resolves to a completed session is treated as no active capture, and a later capture atomically replaces the current pointer.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Active capture lookup is tenant/user scoped and validates the pointer, automation identity, and durable session before exposing a bounded view.
- Start/finish commands accept the opaque capture ID only as a concurrency target; ownership still comes solely from authenticated context and durable state.
- Existing conditional capture-control transitions retain duplicate-delivery idempotency. A stale capture ID cannot mutate a newer current session.
- Active lookup uses two strongly consistent DynamoDB reads (pointer + session), avoiding unbounded partition scans; this is a small control-plane cost and does not add browser/model compute.
- Capture startup writes session + current pointer in one DynamoDB transaction, so the UI cannot observe a pointer to a session whose durable STARTED record was never committed.
- No new retry loop, browser action, model call, secret path, notification behavior, or recovery subsystem was added.
- Live View remains a same-tab HTTPS handoff. After authentication the user returns to the application and refreshes capture state; automatic polling remains a UX improvement for the collector-worker slice.

### Tests / validation

- New core tests cover bounded active-capture views, AUTH_SETUP -> WORKFLOW -> finish, duplicate finish replay, stale-session rejection, cross-tenant suppression, authenticated HTTP ownership, delegation of unrelated routes, and sanitized errors.
- AWS capture-session tests cover atomic STARTED/current-pointer persistence, strongly consistent active lookup, completed-session suppression, completion transaction behavior, and replay classification.
- Web client tests cover authenticated capture-state/start/finish routing and opaque capture-ID forwarding.
- This section does not claim the new head green until GitHub Actions completes on the exact published SHA.

## Next product milestones

1. Run the existing Playwright capture collector as a long-running AgentCore Runtime capture task attached to the active browser session. It must poll the durable control state, record only `WORKFLOW` events, stop on finish/expiry, and invoke the existing IAM-only trusted capture-completion endpoint automatically.
2. Add automatic readiness polling in the Next.js capture UX so finish transitions to compile-ready without manual refresh, while keeping signed Live View URLs and internal browser/profile identifiers out of browser storage and query strings.
3. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs release + deploy without retaining ZIP artifacts in GitHub Actions storage.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Recording controls are now production-composed, but the long-running capture worker still must consume them and call trusted completion; requesting Finish does not yet itself create a trace.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
