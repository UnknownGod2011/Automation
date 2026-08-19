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
- Incoming head `fcfd8d2b9f81ac24e7c648b0a5820b08aa023c51` is green via GitHub Actions CI #137, including deterministic lock verification, frozen install, `pnpm check`, `next build`, and the full tests.

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

- Incoming head `fcfd8d2b9f81ac24e7c648b0a5820b08aa023c51` is green via CI #137.
- This AgentCore capture head must not be called green until GitHub Actions completes successfully on the exact new SHA. No local pass is claimed.

## Next product milestones

1. Obtain exact-head green CI for the AgentCore capture starter; fix only a concrete CI defect if one appears.
2. Add durable capture-session/completion metadata and a trusted capture-completion path that saves the active AgentCore browser session into the automation profile before accepting the trace. The UI should consume the completed trace ID automatically rather than asking users to enter it.
3. Wire concrete AWS SDK Scheduler/Step Functions composition around the already-tested narrow scheduling APIs, keeping missing deployment configuration explicit.
4. Replace the temporary server bearer integration seam with Cognito authentication/API authorization.
5. Implement BYOK credential-pool routing through the secure secret boundary; provider keys must remain outside ordinary application tables/logs.
6. Add SES notifications/CloudWatch observability and one controlled end-to-end human-recovery demonstration.

## Known parked limitations

- Recovery continuation consumption remains parked until the cloud worker requires it; product work takes precedence over narrower recovery micro-edge cases.
- Sensitive runtime values still require the later secret-resolution contract; never place provider keys, passwords, cookies, or equivalent secrets in workflow/runtime-variable metadata.
- Trusted capture completion is not wired yet: the current starter launches the real profiled browser and Live View, but durable session metadata, trace collection/callback authentication, profile save-on-completion, and automatic trace-ID handoff are the next product slice.
- Public HTTP command idempotency, Cognito verification, rate limiting, and capture callback authentication remain required control-plane work.
- The AWS scheduler and Step Functions adapters currently depend on narrow injected AWS API interfaces. Concrete SDK composition remains a small follow-up.
