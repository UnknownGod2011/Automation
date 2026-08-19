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

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `ef28e781dd09dbe0115648ecd58d4e39b5bc81ef` is green via GitHub Actions CI #135, including deterministic lock verification, frozen install, `pnpm check`, `next build`, and the full tests.

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

Added `infra/aws/scheduling-dispatch.yaml` with:

- encrypted SQS dispatch queue and 14-day DLQ;
- bounded redrive (`maxReceiveCount: 5`);
- EventBridge Scheduler group and least-privilege target role permitted to write only the dispatch queue/DLQ;
- Step Functions Standard state machine with a bounded Lambda infrastructure retry policy;
- least-privilege dispatcher permissions for SQS receive/delete/visibility and `states:StartExecution` only on the scheduled-run state machine;
- Lambda event-source mapping with `ReportBatchItemFailures` for queue backpressure and partial retry.

The template intentionally accepts built dispatcher/worker Lambda ARNs instead of embedding source or credentials into CloudFormation. Cloud runtime assembly remains explicit and can return `NOT_CONFIGURED` until deployed.

### Correctness / security / tenancy / concurrency / retry review

- Physical scheduler names are SHA-256-derived from tenant, user, and logical schedule ID, preventing cross-tenant schedule collisions without exposing raw ownership in resource names.
- The schedule payload contains no browser profile, cookies, credentials, runtime secret values, provider keys, DOM data, or prompt contents.
- Scheduler target delivery is bounded and dead-lettered; SQS consumption is bounded by redrive; Step Functions retries only Lambda service/infrastructure errors with a finite retry count. Workflow action retries remain the execution engine's responsibility.
- Queue backpressure is explicit: SQS decouples Scheduler invocation bursts from dispatcher/worker capacity.
- Step Functions duplicate start detection is occurrence-based; the existing run occurrence key and automation lock remain the final authority before browser side effects.
- Dispatcher batch responses contain only failed SQS message IDs, so provider/secret-bearing exception text cannot leak into the SQS response contract.
- Cost is bounded by managed Scheduler invocations, SQS requests, one Standard state-machine execution per accepted occurrence, and the existing browser/model execution budgets. Duplicate Scheduler deliveries should be suppressed before another state-machine execution is created.
- Observability can correlate schedule ID, delivery ID, Step Functions execution ARN and the existing run/occurrence identity without storing sensitive browser or credential data.

### Tests

Added tests for canonical dispatch parsing, validation-before-start, tenant-scoped scheduler names, Scheduler context attributes, schedule round-trip, bounded retry/DLQ configuration, update-vs-create behavior, rejection of unsupported AWS expressions, occurrence-based Step Functions deduplication across delivery attempts, and SQS partial-batch failures.

### Validation status

- Incoming head is green via CI #135.
- The scheduling/dispatch head from this entry must not be called green until GitHub Actions completes successfully on that exact SHA. No local validation claim is made.

## Next product milestones

1. Obtain exact-head green CI for AWS scheduling/dispatch + IaC. Fix only a concrete CI defect if one appears; do not weaken checks.
2. Wire real AWS SDK Scheduler/Step Functions client implementations and deployment composition around the new API boundaries if not already provided by the runtime package, keeping missing configuration explicit.
3. Wire AgentCore Live View/capture and real browser-profile restore/save behind `CaptureSessionStarter` and existing profile/session ports; persist trusted capture-completion metadata so users never manually enter trace IDs.
4. Replace the temporary server bearer integration seam with Cognito authentication/API authorization.
5. Implement BYOK credential-pool routing through the secure secret boundary; provider keys must remain outside ordinary application tables/logs.
6. Add SES notifications/CloudWatch observability and one controlled end-to-end human-recovery demonstration.

## Known parked limitations

- Recovery continuation consumption remains parked until the cloud worker requires it; product work takes precedence over narrower recovery micro-edge cases.
- Sensitive runtime values still require the later secret-resolution contract; never place provider keys, passwords, cookies, or equivalent secrets in workflow/runtime-variable metadata.
- The local/mock path does not create real cloud browser compute.
- Public HTTP command idempotency, Cognito verification, rate limiting, and capture callback authentication remain required control-plane work.
- The AWS scheduler and Step Functions adapters currently depend on narrow injected AWS API interfaces to avoid changing the reviewed dependency graph in this slice. Concrete SDK composition remains a small follow-up, not a reason to fake cloud readiness.
