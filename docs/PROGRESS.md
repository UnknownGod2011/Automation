# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains available in Git history; this checkpoint intentionally emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, verification for side effects, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> schedule -> execute -> history lifecycle without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus the Next.js app provide dashboard/create/capture/compile/test/publish/history and authenticated credential settings.
- Cognito managed login uses authorization-code + PKCE; API Gateway-verified access-token claims become the trusted user boundary while tenant identity remains deployment-owned.
- AgentCore Live View capture restores a server-owned Browser Profile. Durable capture completion saves profile state before accepting immutable captured trace data. Capture trace metadata is tenant-scoped in DynamoDB while full validated traces and workflow versions are immutable S3 documents.
- AgentCore Identity-backed BYOK keeps plaintext provider keys out of ordinary tables. The credential pool is deterministic, tenant-scoped, sanitized, and wired to real OpenAI Responses API reasoning through runtime-only secret retrieval.
- Production fresh tests use AgentCore Runtime and the same hardened browser/BYOK execution plane as scheduled runs; configured cloud deployments cannot silently fall back to browser/model execution in API Lambda.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard -> AgentCore Runtime provides buffered at-least-once scheduling with occurrence-derived durable idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- Scheduled execution composes DynamoDB run/checkpoint/lock state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, SES notifications, CloudWatch EMF telemetry, and trusted Cognito email lookup.
- AgentCore Runtime is packageable as a Node 22 direct-code ZIP and provisioned by `infra/aws/agentcore-runtime.yaml` with a bounded worker role.
- `createAwsControlPlaneBootstrap` composes the production control-plane graph from DynamoDB/S3 persistence, AgentCore Browser/Profile capture, AgentCore Identity credential management, AgentCore Runtime fresh testing, EventBridge Scheduler, Cognito-authenticated HTTP transport, and a separate trusted capture-completion handler.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `62dcf1adb0f15bdf4494c1b73673c12c2c975944` is green on GitHub Actions CI #174.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-20 — deployable control-plane Lambda

### Product slice

Added the process/deployment boundary required to turn the already-composed AWS control plane into a real Lambda artifact.

`createAwsControlPlaneRuntimeEntrypoint` lazily initializes `createAwsControlPlaneBootstrap` once per Lambda execution environment. It returns a fixed sanitized `503 NOT_CONFIGURED` when mandatory deployment composition is absent and a fixed sanitized `500 INTERNAL_ERROR` for bootstrap/provider failures. The initialization promise is memoized so a broken cold-start configuration is not repeatedly reconstructed on every request in the same environment. Configured requests are forwarded unchanged to the existing API Gateway HTTP API v2 Lambda adapter.

`packages/aws/control-plane-lambda.mjs` is the actual Node 22 Lambda handler. `scripts/package-control-plane-lambda.sh` builds contracts/core/AWS, materializes only production dependencies, adds the thin handler, and emits a deterministic ZIP. CI now smoke-builds this ZIP in addition to the existing AgentCore Runtime ZIP; neither package is uploaded as a GitHub Actions artifact.

Added `infra/aws/control-plane-service.yaml` to provision the Lambda, bounded reserved concurrency, 30-day log retention, code from an optionally version-pinned S3 object, required control-plane environment contracts, and a scoped execution role. Its `ControlPlaneLambdaArn` output is intended to feed the already-existing Cognito/API Gateway auth stack.

### Security / tenancy / idempotency / retry / timeout / cost / observability review

- The Lambda role deliberately does not receive `GetResourceApiKey`, workload-token acquisition, browser automation-stream, Step Functions execution, SES-send, or scheduled-worker permissions. Those stay in the execution plane.
- AgentCore Runtime fresh-test invocation is limited to the configured Runtime ARN and includes both `InvokeAgentRuntime` and `InvokeAgentRuntimeForUser`, because the control plane supplies the authenticated user through AgentCore's dedicated Runtime user boundary.
- EventBridge Scheduler mutations are limited to the configured schedule group. `iam:PassRole` is limited to the exact Scheduler target role and `iam:PassedToService = scheduler.amazonaws.com`.
- Browser Profile creation is conditioned on the platform's `managedBy=automation-platform` request tag. Existing Browser Profile resources are the only profile-management resource class granted. Live View connection is isolated in its own wildcard-resource statement because AWS currently defines `ConnectBrowserLiveViewStream` without resource-level authorization.
- Managed API-key provider mutation is restricted to the platform's `automation_*` provider namespace inside AgentCore token vaults; the raw credential remains handled only by the AgentCore Identity control API and is never stored in DynamoDB/S3/logs.
- DynamoDB access is limited to the configured state table/indexes and S3 to the configured artifact prefix. Optional KMS access is limited to the configured artifact key.
- The API Lambda timeout is 29 seconds and reserved concurrency defaults to 20, bounding cost and pressure on DynamoDB/Scheduler/AgentCore. There is no whole-request retry layer in the runtime wrapper.
- A production fresh test remains synchronous across API Gateway -> Lambda -> AgentCore Runtime. API Gateway/Lambda request duration is therefore a known UX/deployment limit for long tests; the next product-facing refinement should move fresh-test initiation to an asynchronous job/status boundary if live validation shows typical tests exceed the HTTP window.
- Lambda bootstrap and provider failures are never reflected verbatim, so environment values, provider exceptions, browser details, secret refs, and keys do not enter public HTTP failures.

### Tests / validation

Regression coverage was added for configured request forwarding, one-time process bootstrap, explicit sanitized `NOT_CONFIGURED`, and sticky sanitized bootstrap failure. CI additionally smoke-packages the production control-plane ZIP.

This implementation, tests, IaC, packaging, CI update, and progress checkpoint are being published as one normal multi-file Git-data commit. Exact-head GitHub Actions is authoritative; this section does not claim the new head green until that run completes.

## Next product milestones

1. Add explicit automation update/pause/disable lifecycle commands so recurrence edits and pausing update or disable the concrete EventBridge Scheduler resource automatically; publish already creates/updates schedules.
2. Add a deployment/release command that uploads both tested ZIPs to versioned S3 objects and wires the resulting object versions/stack outputs without embedding cloud credentials in CI.
3. Close the trusted capture-completion deployment route: a deployment-authenticated worker/API boundary must invoke the already-separated completion handler without exposing it through the ordinary Cognito end-user route.
4. If real fresh tests commonly exceed the API Gateway request window, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Trusted capture-completion worker authentication is not yet provisioned as a deployment resource.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
