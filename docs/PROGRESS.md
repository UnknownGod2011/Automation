# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, checkpointing, verification, occurrence idempotency, tenant ownership, and in-memory adapters.
- Provider-neutral execution engine plus AWS DynamoDB/S3/AgentCore/Playwright adapters behind explicit ports.
- Explicit human pause/repair/resume lifecycle with conditional resolution claims, durable execution leases, heartbeat fencing, redacted audit history, read-only crash reconciliation, and atomic already-applied recovery primitives. Further recovery micro-hardening is parked unless an end-to-end slice or CI exposes a concrete defect.
- Deterministic dependency bootstrap using pinned Node 22.23.2, pnpm 10.15.0 and reviewed lock SHA-256. The AWS DynamoDB peer mismatch is resolved rather than suppressed.
- Versioned capture trace contracts distinguish `AUTH_SETUP` from executable `WORKFLOW` events and keep authentication setup out of scheduled workflow compilation.
- `compileCaptureTrace` emits semantic `WorkflowGraph` definitions, deterministic selectors first, explicit verification for side effects, bounded retry policies, fresh-session navigation, and public literals as `initialVariables`.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- `AutomationControlPlaneService` / HTTP handler expose sanitized provider-neutral dashboard/create/capture/compile/test/publish/history contracts with explicit `CONFIGURED`, `LOCAL_MOCK`, and `NOT_CONFIGURED` capability states.
- `apps/web` provides the Next.js dashboard, create automation, capture state, compile/test/publish controls, recurrence/timezone configuration and run history. Server-only control-plane credentials, same-origin mutation checks, sanitized upstream errors, and explicit missing-integration states are preserved.
- AWS scheduling/dispatch transport and IaC implement EventBridge Scheduler -> SQS -> Step Functions Standard with occurrence-based duplicate suppression and bounded retries.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `f732a177f0a68f7e77b91f7f1f0bee6fd4ed01f3` is green via GitHub Actions CI #139.

## 2026-08-19 — AWS scheduling / dispatch + IaC

### Product slice

Added a provider-neutral scheduled-dispatch transport contract and AWS-first adapters for the published automation path:

EventBridge Scheduler -> SQS dispatch queue -> dispatcher -> Step Functions Standard -> scheduled-run worker.

The existing `ScheduledRunCoordinator` remains authoritative for occurrence idempotency, immutable workflow selection, browser-profile preflight, automation execution locking, and run creation. The AWS transport does not duplicate those state machines.

`ScheduledDispatchEnvelope` is a versioned, tenant-scoped payload containing only ownership identity, automation/schedule identity, the exact scheduled instant, and a delivery identifier. Transport parsing rejects malformed schema, ownership, automation identity, and timestamps before durable execution is started.

`AwsEventBridgeSchedulerAdapter` maps `SchedulerPort` registrations to tenant-scoped physical schedule names. It uses EventBridge Scheduler context substitution for `<aws.scheduler.scheduled-time>` and `<aws.scheduler.execution-id>`, preserves the original schedule kind for read-back, requires AWS-compatible `rate(...)` / `cron(...)` expressions, disables flexible delivery jitter, and configures bounded delivery retry metadata plus a DLQ through its AWS API boundary.

`AwsStepFunctionsScheduledExecutionStarter` derives the Step Functions execution name from tenant + user + automation + scheduled instant rather than the Scheduler delivery attempt. A redelivery of the same occurrence therefore resolves to `DUPLICATE` at the durable orchestration boundary instead of starting another state machine. This is an optimization/safety layer in addition to the existing occurrence uniqueness in `RunRepository`.

`AwsSqsScheduledDispatchHandler` uses partial batch failure semantics. Successful queue messages are not retried merely because another message in the same Lambda batch fails. Error details are not returned in the batch response.

### Infrastructure as code

Added `infra/aws/scheduling-dispatch.yaml` with encrypted SQS dispatch/DLQ resources, bounded redrive, Scheduler target IAM, Standard Step Functions orchestration, least-privilege dispatcher permissions and partial-batch Lambda event-source mapping.

### Correctness / security / tenancy / concurrency / retry review

- Physical scheduler names are SHA-256-derived from tenant, user, and logical schedule ID, preventing cross-tenant schedule collisions without exposing raw ownership in resource names.
- The schedule payload contains no browser profile, cookies, credentials, runtime secret values, provider keys, DOM data, or prompt contents.
- Scheduler target delivery is bounded and dead-lettered; SQS consumption is bounded by redrive; Step Functions retries only Lambda service/infrastructure errors with a finite retry count.
- Queue backpressure is explicit, and occurrence idempotency remains authoritative before browser side effects.

### Validation status

- Corrective head `fcfd8d2b9f81ac24e7c648b0a5820b08aa023c51` is green via CI #137.

## 2026-08-20 — AgentCore Live View capture starter

### Product slice

Added the first real AWS implementation of the existing provider-neutral `CaptureSessionStarter` without changing the reviewed dependency graph. `AgentCoreCaptureSessionStarter` creates an isolated AgentCore Browser session, restores the automation's server-owned browser profile, and returns a time-bounded Live View URL for the control-plane Capture Workflow experience.

`AwsAgentCoreBrowserLiveViewSigner` uses the already-pinned `bedrock-agentcore` Browser SDK to attach the newly-created session and generate the SigV4-presigned Live View URL. AgentCore's documented Live View endpoint is interactive and intended for end-user takeover; browser profiles preserve cookies/local storage across later sessions when explicitly saved.

### Correctness / security / tenancy / cost review

- The starter rejects automation objects whose embedded tenant/user ownership differs from the trusted request scope before any browser compute is created.
- The browser profile reference remains server-owned. It is parsed by the AWS adapter and sent only to AgentCore; it is not added to the public capture response.
- Physical session names and idempotency material are derived from hashed/scoped identities rather than raw tenant/user IDs.
- Live View URLs must be HTTPS and contain no embedded username/password credentials. The concrete AWS signer additionally verifies the expected region-specific AgentCore hostname.
- Session and presigned-URL lifetimes are bounded and validated before cloud allocation. Defaults are one hour and can be lowered by composition.
- If Live View signing fails after session creation, the new browser session is stopped. If cleanup also fails, both failures are preserved for server-side diagnosis rather than silently leaking orphaned compute.
- Starting capture still creates billable AgentCore browser compute, so UI/API rate limiting and active-session deduplication remain necessary before broad public exposure.

### Tests

Added regression coverage for profiled session startup, bounded Live View expiry, tenant isolation, required profile ownership, signing-failure cleanup, unsafe URL rejection, and timeout/TTL validation.

### Validation status

- CI #138 on `c30610ec1ca577372e6cb980546941e4a81117a9` passed deterministic lock verification, frozen installation, contracts/core/web checking, then failed the AWS strict type gate because `exactOptionalPropertyTypes` rejected an optional viewport field assignment of `undefined`. Tests were correctly skipped after type-check failure.
- Corrective head `f732a177f0a68f7e77b91f7f1f0bee6fd4ed01f3` is green via CI #139.

## 2026-08-20 — Durable capture completion boundary

### Product slice

Added provider-neutral durable capture-session metadata and a trusted capture-completion service. A cloud capture session is now represented by tenant/user/automation identity, an opaque public capture-session ID, the server-only AgentCore browser-session ID, server-owned browser-profile reference, bounded lifetime, status, and eventual trace ID. `AgentCoreCaptureSessionStarter` now refuses to allocate browser compute when no durable capture-session store is configured, and it persists STARTED metadata before returning a Live View URL. If durable registration fails, the newly-created AgentCore session is stopped.

`CaptureCompletionService` validates the exact ownership/automation/profile boundary, requires the session to still be live, saves the active browser session back into the automation's Browser Profile before accepting the capture trace, persists the trace through the existing lifecycle boundary, then durably marks the capture complete. Exact completed replay returns the existing trace ID without repeating browser/trace side effects. Browser-session stop happens after durable completion; cleanup failure is surfaced as `cleanupPending` rather than revoking an accepted trace.

A separate `TrustedCaptureCompletionHandler` requires deployment middleware to assert `trustedCaptureWorker`; ordinary user-authenticated dashboard traffic is not sufficient to call the completion boundary. Errors are sanitized to a fixed rejection response.

### AWS durability

Added `AwsDynamoCaptureSessionStore` behind a narrow injected DynamoDB document-client interface. STARTED records use conditional create-only writes. Completion uses one DynamoDB transaction to replace the session record and write the automation's latest-completed-capture pointer. Reads used for durable identity/replay classification are strongly consistent. Conditional contention returns replay only when the winning completed record has the exact same trace ID; other contention conflicts and non-conditional DynamoDB uncertainty propagates.

`AgentCoreCaptureSessionFinalizer` uses the existing `SaveBrowserSessionProfile` API with a stable scoped client token before trace acceptance, then stops the ephemeral browser session after completion.

### Security / tenancy / idempotency / cost / recovery review

- Browser-session IDs and browser-profile references stay server-side and never enter the Live View response or trusted-handler error response.
- Durable records and DynamoDB partitions are scoped by tenant/user; completion also requires exact automation and profile identity.
- Duplicate completed callbacks are non-executing. The remaining crash window between trace persistence and capture-session completion requires exact trace-persistence replay support before automatic callback retry can be considered fully crash-safe; this is explicitly left as the next narrow completion task rather than broad recovery work.
- Capture browser compute is stopped after durable completion. If stop fails, the caller receives `cleanupPending=true`; operational retry/metrics are still required before public scale.
- No new dependency was added and the reviewed pnpm graph is unchanged.

### Tests

Added provider-neutral tests for save-profile-before-trace ordering, completed replay suppression, cross-automation/expiry rejection, and cleanup-pending behavior. Added AWS tests for conditional durable start, strongly consistent reads, atomic completion/latest-pointer persistence, and same-trace contention replay. Existing AgentCore capture tests now verify durable STARTED registration and fail closed when the durable store is absent.

### Validation status

- This run publishes one normal batched commit only. No local pass is claimed because the execution environment cannot resolve github.com; GitHub Actions on the exact new head is authoritative and must complete before this slice is called green.

## Next product milestones

1. Obtain exact-head green CI for the durable capture-completion slice; root-cause any real failure before using the single allowed corrective commit.
2. Close the remaining capture-completion retry seam by making exact same-trace persistence idempotent, then surface `latestCompletedForAutomation().traceId` through the sanitized control-plane summary so the Next.js compile step consumes it automatically instead of asking the user to type a trace ID.
3. Wire concrete AWS SDK Scheduler/Step Functions composition around the already-tested narrow scheduling APIs, keeping missing deployment configuration explicit.
4. Replace the temporary server bearer integration seam with Cognito authentication/API authorization.
5. Implement BYOK credential-pool routing through the secure secret boundary; provider keys must remain outside ordinary application tables/logs.
6. Add SES notifications/CloudWatch observability and one controlled end-to-end human-recovery demonstration.

## Known parked limitations

- Recovery continuation consumption remains parked until the cloud worker requires it; product work takes precedence over narrower recovery micro-edge cases.
- Sensitive runtime values still require the later secret-resolution contract; never place provider keys, passwords, cookies, or equivalent secrets in workflow/runtime-variable metadata.
- Capture completion is now durable and trusted, but the existing user-facing summary still does not surface the latest completed trace ID automatically. The compile form therefore remains manual for one more slice.
- A callback replay after trace persistence but before durable capture completion can still encounter immutable trace persistence; exact same-trace replay must be added before enabling automatic callback retries.
- Public HTTP command idempotency, Cognito verification, rate limiting, and production capture-worker authentication middleware remain required control-plane work.
- The AWS scheduler and Step Functions adapters currently depend on narrow injected AWS API interfaces. Concrete SDK composition remains a small follow-up.
