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
- Incoming head `208750215802690fb431ed5dd4cd4cd877a1b801` is green on GitHub Actions CI #186.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — durable capture recording control

### Product slice

The capture collector now has a provider-neutral durable control contract for the user-visible teaching phases: `AUTH_SETUP`, `WORKFLOW`, and a one-way finish request. `CaptureCollectionControlService` validates the durable capture session, tenant/user/automation ownership, active STARTED state, and expiry before accepting Start Workflow or Finish commands. Repeated identical commands are idempotent replays; invalid backwards transitions fail closed.

`AwsDynamoCaptureCollectionControlStore` persists control state separately from browser/session metadata in the existing tenant-scoped DynamoDB table. Initial state is create-only, phase/finish transitions use conditional updates, and contention is classified only after a strongly consistent read. DynamoDB throttling/transport uncertainty propagates instead of being converted into a false replay.

`AgentCoreCaptureSessionStarter` now has an explicit control-store hook and initializes `AUTH_SETUP` state at capture startup when that durable store is composed. This keeps authentication interaction separate from recorded workflow actions and gives the long-running collector a durable signal source rather than process memory.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Control keys remain tenant/user scoped and embedded ownership is revalidated on read.
- The command service verifies the capture belongs to the authenticated automation before any phase mutation.
- Finish is allowed only after `WORKFLOW`; an AUTH_SETUP-only session cannot accidentally be accepted as a workflow demonstration.
- Duplicate UI delivery is safe through conditional/idempotent transitions. Competing or backwards transitions are rejected rather than guessed.
- The control record contains no cookies, typed values, Browser Profile contents, BYOK material, workload tokens, or Live View credentials.
- Strongly consistent polling is intentionally a small control-plane cost; the runtime integration should use a sensible polling interval and terminate immediately after finish/expiry rather than increasing browser lifetime.
- This slice does not add browser actions, model calls, retries, notification paths, or recovery machinery.

### Tests / validation

- Core tests cover AUTH_SETUP -> WORKFLOW -> finish, idempotent duplicate commands, cross-tenant rejection, finish-before-recording rejection, and expiry rejection.
- AWS tests cover create-only persistence, strongly consistent reads, concurrent replay classification, illegal finish ordering, and propagation of DynamoDB uncertainty.
- This section does not claim the new head green until GitHub Actions completes on the exact published SHA.

## Next product milestones

1. Compose the durable capture-control store into the production control-plane bootstrap and long-running AgentCore capture worker, then route collector completion into the existing IAM-only trusted completion handler automatically.
2. Add authenticated control-plane/Next.js controls for “Start recording workflow” and “Finish capture”, plus readiness polling so the user never copies internal capture IDs.
3. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs release + deploy without retaining ZIP artifacts in GitHub Actions storage.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- The durable capture-control adapter exists, but production bootstrap/runtime/UX composition remains the next outward seam; no claim is made that a real capture worker is launched by these commands yet.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
