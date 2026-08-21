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
- Incoming head `601cdcf6b26dd3e999739c1e159852da154fbf91` is green on GitHub Actions CI #185.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — capture observation collector foundation

### Product slice

A provider-neutral `CaptureCollectionService` now owns the boundary that turns an active, durable capture session plus observed browser events into a validated `CaptureTrace`. It revalidates tenant/user/automation ownership, Browser Profile identity, STARTED session state, session timestamps, and the final trace contract before any trace can be accepted downstream.

The new AWS `AgentCorePlaywrightCaptureEventSource` attaches to the existing AgentCore Browser automation stream over Playwright/CDP while the user remains interactive through the separate Live View stream. It instruments current and future documents for click, form-submit, input-change, and top-level navigation observations. A durable/control-plane signal abstraction supplies the explicit `AUTH_SETUP` versus `WORKFLOW` phase and the finish request; the collector itself does not guess where authentication ends.

Typed values are deliberately never captured as raw text. Every observed input is represented as an unresolved sensitive `RUNTIME_VARIABLE`, so passwords, tokens, private form text, and other target-site inputs cannot leak into the capture trace merely because the user typed them during Live View. Authentication events can therefore be retained as capture context while remaining excluded by the existing compiler. The collector also does not invent `expectedEffect` verification when browser evidence cannot prove one; side-effecting events without a valid effect contract must still be corrected/enriched before compilation can safely succeed.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- The collection service rejects cross-tenant/cross-user/cross-automation sessions before opening the browser observation source.
- Raw input values are not sent across the Playwright binding or persisted in capture events. Semantic target metadata remains bounded and lives only in the protected capture trace/evidence path.
- Live View and the automation stream are separate AgentCore Browser channels; collection observes the same session rather than starting a second browser. This avoids duplicate browser-session cost and preserves the server-owned Browser Profile.
- The source uses a bounded CDP connection timeout and bounded control polling. Session expiry fails closed instead of silently persisting a partial successful capture.
- Collection does not perform website actions, model reasoning, retries, schedule delivery, or human-recovery transitions. It is an observation boundary only.
- The explicit phase/finish control is intentionally an interface in this slice. The next deployment slice must persist that control durably and drive it from authenticated UX/runtime commands rather than process memory.

### Tests / validation

- Core tests cover successful trace construction, tenant isolation before event-source work, completed-session rejection, and expiry rejection.
- AWS tests cover CDP connection configuration, event observation, and the guarantee that a browser-supplied raw typed value is absent from emitted capture events.
- This section does not claim the new head green until GitHub Actions completes on the exact published SHA.

## Next product milestones

1. Persist capture collector control state (`AUTH_SETUP` / `WORKFLOW` / finish) and run the collector as a long-running AgentCore Runtime task attached to the capture browser session; finishing capture must feed the resulting trace into the existing IAM-only trusted completion boundary automatically.
2. Add authenticated Next.js capture controls for “Start recording workflow” and “Finish capture”, plus readiness polling so the user never copies internal capture IDs.
3. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs release + deploy without retaining ZIP artifacts in GitHub Actions storage.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Capture completion is IAM-only and durable, but collector phase/finish state is not yet persisted or wired into the Runtime/UX; this run establishes the observation primitive rather than pretending the remaining control channel exists.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
