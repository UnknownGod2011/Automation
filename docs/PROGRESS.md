# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

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
- Long-running capture collection now runs inside AgentCore Runtime after the durable `AUTH_SETUP -> WORKFLOW` transition. The Playwright collector observes workflow activity only, excludes raw typed values, polls durable finish state, and hands the completed trace to the existing Browser Profile + immutable trace completion authority.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Last confirmed green head before the current capture-worker changes was `c761ff4aac60bde8ae4248423edbe194dd7e4fd7` on GitHub Actions CI #188.
- Incoming head `96e6ec5f9bf00f2dddfe17438e6a1223ababf031` is red on CI #190. Deterministic lock verification and frozen install passed; contracts/core/web type checking passed; AWS type checking failed at `packages/aws/src/control-plane-bootstrap.ts` because the narrow capture-session DynamoDB test seam was incorrectly passed to the wider capture-control store.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — capture composition repair + automatic readiness UX

### Product slice

The AWS control-plane composition now scopes `captureDynamo` only to `AwsDynamoCaptureSessionStore`, whose command contract it was designed to fake. `AwsDynamoCaptureCollectionControlStore` uses the main `DynamoDocumentClientLike`, which supports the required Get/Put/Update command set. This is the root-cause repair for CI #190; TypeScript strictness is not weakened and the production client remains unchanged.

The authenticated automation page now performs bounded automatic readiness polling after **Finish capture**. A small client component calls `router.refresh()` every two seconds for at most 60 attempts while durable capture state says Finish was requested and no `latestCompletedCapture` is visible yet. Once the trusted completion path exposes the completed trace, the refreshed server view stops polling and renders **Compile latest capture** automatically. A manual refresh link remains available after the two-minute polling window.

The client polling contract receives only a boolean `enabled` flag. It does not receive the AgentCore browser-session ID, Browser Profile reference, capture-session ID, trace ID, Live View URL, tenant/user identity, provider credentials, or workload token. The trace ID continues to appear only in the server-rendered compile form after trusted completion has made that trace authoritative.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Polling is read-only and request-scoped through the existing authenticated server page; it cannot mutate capture state or broaden ownership authority.
- Polling is bounded to one refresh every two seconds for at most two minutes, preventing an unbounded browser refresh loop or persistent control-plane request amplification.
- Capture completion remains authoritative and idempotent; polling never treats elapsed time or a successful refresh request as proof of completion.
- No new browser/model operation, external side effect, retry layer, AWS permission, cloud resource, or dependency was added.
- If completion is slow or a background collector fails, automatic polling stops and the existing manual refresh/retry/expiry behavior remains visible instead of manufacturing a successful capture.

### Tests / validation

- Web unit coverage proves polling starts only after Finish is requested and before a completed capture exists, and that the interval/window remain bounded.
- The existing AWS bootstrap/type boundary now compiles against the correct DynamoDB client capability rather than widening or casting the narrow capture-session seam.
- This section does not claim the new head green until GitHub Actions completes successfully on the exact published SHA.

## Next product milestones

1. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs immutable release + ordered deploy without retaining ZIP artifacts in GitHub Actions storage.
2. Perform one controlled real AWS demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
3. Close only defects exposed by that vertical demo, including collector replacement-worker recovery only if the live demo proves it necessary; do not return to speculative recovery micro-hardening.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Capture-task duplicate suppression is process-local while the durable completed-session boundary is global. If a Runtime process is replaced mid-recording, the controlled AWS demo should determine whether a small durable collector claim is required.
- A background collector failure currently leaves WORKFLOW/finish state durable for user-visible retry/expiry rather than manufacturing a trace. The new bounded readiness polling makes that state visible without polling forever; a richer failure-status surface should be added only if the real demo shows it is needed.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
