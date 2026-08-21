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
- Cognito managed login, API Gateway JWT authorization, AgentCore Live View/Profile capture, durable capture completion, immutable S3 capture/workflow documents, AgentCore Identity BYOK, OpenAI Responses reasoning, production fresh tests, SES notifications, CloudWatch telemetry, and tenant-scoped DynamoDB state are all composed behind AWS adapters.
- Scheduled execution is EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard -> AgentCore Runtime. Occurrence-derived durable idempotency, automation locking, bounded retries, explicit verification, and DLQ/backpressure remain authoritative.
- AgentCore Runtime and the control-plane/capture Lambda artifact are deterministic Node 22 ZIP packages. Immutable release objects are create-only in versioned S3 and recorded with exact VersionIds.
- `scripts/deploy-aws-release.sh` deploys Cognito bootstrap -> AgentCore Runtime -> scheduling -> control plane/capture completion -> Cognito route finalization -> optional observability using short-lived AWS CLI credentials and immutable artifact coordinates.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `095f51c8b8d712dd76785c011f66be0e4f530c57` is green on GitHub Actions CI #184.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — self-contained scheduled dispatcher deployment

### Product slice

The scheduling stack no longer requires a pre-created dispatcher Lambda ARN or role name. `infra/aws/scheduling-dispatch.yaml` now provisions the dispatcher function, its execution role, and the SQS event-source mapping inside the same stack that owns the queues and Step Functions state machine.

The dispatcher reuses the already-reviewed immutable control-plane ZIP rather than introducing a third release artifact. `dispatcher-lambda.mjs` is packaged alongside the control-plane and capture-completion entrypoints and calls the existing `AwsSqsScheduledDispatchHandler` through `createAwsSchedulingComposition`. The Lambda receives only deployment-owned queue/DLQ/Scheduler/state-machine coordinates through environment variables; it does not receive tenant secrets, Browser Profiles, BYOK keys, workload tokens, or AgentCore browser permissions.

The dispatcher IAM role is intentionally narrow: Lambda logging, receive/delete/visibility access to the one dispatch queue, and `states:StartExecution` on the one scheduled-run state machine. It cannot invoke AgentCore Runtime directly, mutate schedules, read application state, access S3 artifacts, retrieve BYOK credentials, or send SES mail.

`package-control-plane-lambda.sh` now requires the dispatcher entrypoint. `release-aws-artifacts.sh` also rejects a supplied/prebuilt control-plane ZIP that lacks it, so immutable release validation cannot silently accept an artifact that would make scheduling undeployable.

`deploy-aws-release.sh` derives the dispatcher code bucket/key/VersionId from the release manifest's immutable control-plane artifact and passes those coordinates into the scheduling stack. Environment configuration cannot override those code coordinates or reintroduce externally owned `DispatcherFunctionArn` / `DispatcherFunctionRoleName` inputs.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- The dispatcher is transport-only. Tenant/user ownership remains inside the signed/trusted scheduled envelope and is revalidated later by the execution path; the dispatcher has no authority to rewrite ownership or access tenant data.
- Duplicate SQS delivery remains safe through occurrence-derived Step Functions execution naming plus the downstream durable run occurrence key. The dispatcher adds no browser/model retry layer.
- `ReportBatchItemFailures` remains enabled, so one malformed/transient record does not force successful records in the same batch to be retried.
- Reserved concurrency bounds dispatch fan-out and cost. SQS remains the backpressure buffer and the existing DLQ/redrive policy remains unchanged.
- The function is pinned to the exact versioned release object, eliminating mutable-code drift between control-plane and dispatcher deployment.
- No new package dependency, cloud credential store, GitHub Actions artifact, or recovery mechanism is introduced.

### Tests / validation

- The control-plane packaging smoke test now fails if `dispatcher-lambda.mjs` is absent.
- The release-contract test proves a prebuilt artifact without the dispatcher is rejected before any S3 upload.
- The deployment-contract test proves the scheduling stack receives the exact immutable dispatcher code coordinates from the release manifest and no longer receives external dispatcher ARN/role inputs. It also proves environment overrides of dispatcher code identity fail before AWS calls.
- This section does not claim the new head green until GitHub Actions completes on the exact published SHA.

## Next product milestones

1. Wire the concrete capture event collector/worker to the IAM-only `CaptureCompletionInvokeArn` so finishing a Live View demonstration automatically persists the trusted trace and Browser Profile without a manual seam.
2. Add a deployment workflow/example using GitHub OIDC/short-lived AWS credentials that runs release + deploy without retaining ZIP artifacts in GitHub Actions storage.
3. If real fresh tests exceed API Gateway request limits, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- The IAM-authenticated capture-completion route is provisioned, but the concrete capture event collector/worker that receives browser events and invokes it is still a deployment seam.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
