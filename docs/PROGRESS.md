# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, verification, checkpointing, occurrence idempotency, tenant ownership, and in-memory adapters.
- Deep provider-neutral execution/human-recovery substrate: durable human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Deterministic dependency bootstrap using pinned Node 22.23.2, pnpm 10.15.0, and a reviewed lock SHA-256. The known DynamoDB/lib-dynamodb peer mismatch was resolved rather than suppressed.
- Versioned capture trace contracts distinguish `AUTH_SETUP` from executable workflow events. `compileCaptureTrace` emits semantic `WorkflowGraph` definitions with deterministic selectors first, explicit side-effect verification, bounded retries, fresh-session navigation, and public initial variables.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- Provider-neutral control-plane service/HTTP contracts expose sanitized dashboard/create/capture/compile/test/publish/history operations with explicit configuration capability states.
- `apps/web` provides the Next.js dashboard, create, capture, compile, fresh test, recurrence/timezone publish, and run-history UX with server-only control-plane credentials and same-origin mutation checks.
- AWS transport/IaC define EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves the authenticated profile before accepting the trace, atomically records latest completed capture state, and supports exact same-trace persistence reconciliation after acknowledgement loss.
- The automation summary now exposes only safe latest-capture `{traceId, completedAt}` metadata, and the Next.js compile step no longer asks users to copy a server trace identifier.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `288e4e807884fd8337a7ae7e80e44a00f287cab4` is green via GitHub Actions CI #144.

## 2026-08-20 — Concrete AWS scheduling composition

### Product slice

Added the deployable AWS SDK composition boundary around the existing tested scheduling/dispatch ports. `AwsSdkSchedulerApi` translates the narrow `AwsSchedulerDefinition` into official EventBridge Scheduler v3 `CreateSchedule`, `GetSchedule`, `UpdateSchedule`, and `DeleteSchedule` commands. Read-back is validated before it becomes provider-neutral state; malformed or partial provider responses fail closed. `ResourceNotFoundException` is the only absence condition normalized to `null`; throttling, authorization, network, and other provider uncertainty propagate.

Added `AwsSdkStepFunctionsApi`, which maps the existing occurrence-idempotent scheduled execution starter to the official Step Functions v3 `StartExecution` command and rejects a malformed response without an execution ARN. The existing `AwsStepFunctionsScheduledExecutionStarter` remains responsible for occurrence-derived execution names and duplicate classification, so cloud composition does not create a second idempotency model.

`loadAwsSchedulingDeploymentConfig` defines the production environment contract from the existing CloudFormation outputs:

- `AWS_REGION` or `AWS_DEFAULT_REGION`
- `AWS_SCHEDULE_DISPATCH_QUEUE_ARN`
- `AWS_SCHEDULE_DISPATCH_DLQ_ARN`
- `AWS_SCHEDULER_TARGET_ROLE_ARN`
- `AWS_SCHEDULER_GROUP_NAME`
- `AWS_SCHEDULED_RUN_STATE_MACHINE_ARN`

`createAwsSchedulingComposition` returns a fail-closed unconfigured result until all deployment identifiers are present. It then constructs the standard AWS credential-chain clients, Scheduler adapter, Step Functions execution starter, and SQS dispatch handler. Missing cloud credentials are not embedded or fabricated; credential resolution stays with the AWS SDK workload/environment provider chain.

### Dependency / security / tenancy / idempotency / cost review

- Added direct `@aws-sdk/client-scheduler` and `@aws-sdk/client-sfn` dependencies pinned to `3.1111.0`, aligned with the already-reviewed AWS SDK generation used by DynamoDB.
- No credential, browser profile, tenant identity, objective, DOM content, or runtime variable is added to environment configuration.
- Scheduler target payloads remain the previously-reviewed bounded tenant-scoped occurrence envelope. The concrete SDK layer does not broaden payload contents.
- Flexible delivery remains explicitly `OFF`; bounded retry/DLQ metadata is preserved exactly through SDK translation.
- Standard Step Functions remains the durable orchestration type. Existing occurrence-derived execution naming and the downstream run occurrence key continue to protect duplicate schedule delivery before browser side effects.
- Concrete composition introduces no additional polling or background cloud calls. Cost behavior remains schedule invocation + SQS + Standard Step Functions + worker/browser/model work already described in architecture.

### Tests

Added regression coverage for missing-deployment configuration, complete IaC-output composition, Scheduler command translation/read-back validation, not-found versus uncertain-provider failure handling, Step Functions command translation, and malformed provider response rejection.

### Validation status

- This is the single normal CI-triggering product commit for the run. GitHub Actions on its exact head is authoritative.
- Because two direct AWS SDK dependencies were intentionally added, the deterministic lock gate is expected to require review of the newly generated pnpm lock SHA before frozen installation. If CI reports only that reviewed supply-chain drift, one corrective commit may update the pinned hash; no dependency gate will be bypassed.

## Next product milestones

1. Replace the temporary server bearer integration seam with Cognito authentication/API authorization while preserving trusted tenant/user context server-side.
2. Implement BYOK credential-pool routing through the secure secret/AgentCore Identity boundary; provider keys must remain outside ordinary application tables and logs.
3. Add SES notifications and CloudWatch/AgentCore observability for run success/failure/attention states.
4. Perform one controlled end-to-end AWS demonstration covering publish -> scheduled dispatch -> cloud browser execution -> verification/history and one bounded human takeover/resume failure path.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive runtime values still need the planned secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- Public HTTP command idempotency, Cognito verification, rate limiting, and production capture-worker authentication middleware remain required control-plane work.
- Dashboard latest-capture lookup currently adds one durable read per automation; optimize only if observed scale/cost justifies denormalization.
- Real AWS credentials are not available in CI, so SDK composition is validated with deterministic command-level tests; live deployment validation remains a later environment gate.
