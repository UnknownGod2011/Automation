# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed product foundation

- Strict TypeScript/pnpm monorepo with deterministic dependency bootstrap, pinned Node/pnpm versions, reviewed lock SHA-256, and the prior AWS DynamoDB peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and in-memory adapters.
- Deep execution/human-recovery substrate: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts and `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, explicit verification, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history UX with same-origin mutation checks.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- `AgentCoreIdentityCredentialVault` stores BYOK API keys as AgentCore Identity managed API-key credential providers. Raw provider keys stay out of normal application metadata.
- Provider-neutral credential-pool routing and authenticated credential settings support deterministic BYOK selection, runtime-only secret resolution, health/cooldown policy, and sanitized create/list/rotate/remove operations.
- `OpenAiCredentialBoundReasoningProviderFactory` provides the first concrete BYOK reasoner using the fixed OpenAI Responses endpoint, Structured Outputs, local policy revalidation, bounded network/context/output limits, and sanitized provider failures.
- `AwsScheduledRunHandler` binds trusted occurrence scope, AgentCore workload token, deterministic occurrence run ID, OpenAI BYOK reasoning, browser execution, and durable reporting.
- `ScheduledRunOutcomeReporter`, CloudWatch EMF telemetry, and the ownership-scoped SES notification port report success/failure/attention without becoming execution authority.
- `createAwsScheduledRunBootstrap` assembles the concrete AWS scheduled execution dependency graph from deployment configuration: DynamoDB state/locks/credential metadata, immutable S3 workflow documents and evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, and SES/EMF reporting.
- AWS dispatch infrastructure provides EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `55241c4274edcb86280c9ab3a655559a653ed62a` is green on GitHub Actions CI #161.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — AgentCore scheduled execution host boundary

### Product slice

Closed the direct-Lambda scheduled-worker seam. `infra/aws/scheduling-dispatch.yaml` now routes the Step Functions Standard execution task to Amazon Bedrock AgentCore Runtime through the Step Functions AWS SDK integration for `InvokeAgentRuntime`. The scheduled dispatch envelope remains the runtime payload, while AgentCore `RuntimeUserId` is populated from the occurrence's user ownership and the execution role is limited to `bedrock-agentcore:InvokeAgentRuntime` plus `bedrock-agentcore:InvokeAgentRuntimeForUser` on the configured runtime ARN.

The state machine no longer invokes the scheduled-run worker Lambda directly. Its payload is JSON-stringified and Base64 encoded at the service-integration boundary, content type/accept are fixed to JSON, and one invocation has a deployment-configurable hard timeout (`60..3600` seconds, default `1800`). There is intentionally no Step Functions retry around `InvokeAgentRuntime`: run occurrence idempotency and workflow-level retry/verification remain authoritative, and an outer retry after an uncertain runtime response could otherwise duplicate a partially completed external action.

Added `AwsAgentCoreScheduledRuntimeEntrypoint`, the AWS-host boundary inside AgentCore Runtime. It derives trusted ownership from two sources that are intentionally separate from scheduled JSON: `AUTOMATION_TENANT_ID` is deployment configuration, while `runtimeUserId` comes from the AgentCore invocation context. The entrypoint forwards Runtime-injected headers, including `WorkloadAccessToken`, to the existing `AwsScheduledRunHandler`; that handler still validates that the scheduled envelope's embedded scope exactly matches this trusted scope before BYOK lookup, browser allocation, or model work.

Added `createAwsAgentCoreScheduledRuntime` to compose this entrypoint with the existing production scheduled-run bootstrap. Missing tenant/runtime-worker configuration is aggregated into a stable `NOT_CONFIGURED` result and network calls remain deferred until invocation.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- The workload access token is still supplied only by AgentCore Runtime and never enters EventBridge Scheduler, SQS, Step Functions state, environment variables, DynamoDB, S3 workflow metadata, browser profiles, or user-facing responses.
- The user identity passed to AgentCore Runtime is bounded to the service's 128-character limit by the host entrypoint. Empty/oversized identities fail before worker execution.
- Tenant identity is deployment-owned, not accepted from the occurrence payload. The existing handler independently compares the payload tenant/user to trusted invocation scope before composing execution.
- Scheduler/SQS delivery remains at-least-once. Step Functions execution names and durable run IDs remain occurrence-derived, not delivery-ID-derived, so transport redelivery converges on existing occurrence authority.
- No additional outer execution retry is introduced at the AgentCore invocation layer. Browser/model node retries remain bounded and every consequential browser action still requires its existing verification contract.
- Step Functions receives only the small canonical dispatch envelope. Base64 encoding has a 10,000-character intrinsic-input ceiling, which intentionally fails closed if this control-plane envelope ever grows unexpectedly rather than allowing large arbitrary payloads into the execution host.
- Runtime invocation IAM is scoped to the configured runtime ARN. The dispatcher still has only queue-consumption and `states:StartExecution` permissions; Scheduler still only sends to its queue/DLQ.
- Cost impact is one AgentCore Runtime invocation per accepted scheduled occurrence; removal of the direct worker Lambda avoids adding another long-lived browser/model execution host. Queue buffering and Standard Step Functions continue to provide backpressure and orchestration visibility.
- No package dependency changed, so the reviewed pnpm dependency graph should remain unchanged.

### Tests added

Regression coverage proves:

- missing `AUTOMATION_TENANT_ID` is explicit `NOT_CONFIGURED`,
- Runtime + scheduled-worker configuration gaps aggregate instead of partially constructing execution,
- the host derives trusted scope only from deployment tenant + Runtime user identity and forwards Runtime headers/payload unchanged,
- missing or oversized Runtime user identity is rejected before the scheduled-run handler can execute.

### Validation status

- Incoming head `55241c4274edcb86280c9ab3a655559a653ed62a` is confirmed green on CI #161.
- Source, tests, AWS export surface, scheduling IaC, and this progress update are being published as one normal CI-triggering Git-data commit.
- No dependency manifest is changed, so a lock-snapshot refresh is not expected.
- Exact-head GitHub Actions remains authoritative; no green result for this slice is claimed until it exists.

## Previous milestone — production scheduled-run bootstrap composition

`createAwsScheduledRunBootstrap` constructs the real scheduled-run dependency graph without live network calls at composition time: DynamoDB automation/run/checkpoint/lock/credential state, immutable S3 workflow/evidence storage, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright/CDP execution and verification, OpenAI BYOK reasoning, and optional SES/EMF reporting. Incoming CI #161 validates that milestone.

## Next product milestones

1. Add the concrete AgentCore Runtime resource/package deployment plus least-privilege worker execution role and stack outputs required by `createAwsAgentCoreScheduledRuntime`: DynamoDB state, S3/KMS artifacts, AgentCore Browser/Profile/Identity data access, logs, and runtime code artifact configuration.
2. Add a trusted user-directory/email resolver backed by authenticated control-plane data or Cognito administration data; never derive an email by guessing from `sub`.
3. Compose the control-plane Lambda handler from API Gateway/Cognito verified claims and the existing control-plane HTTP service, with explicit deployment `NOT_CONFIGURED` states where backing stores are absent.
4. Add deployment-level wiring between the control-plane/scheduling/runtime stacks so publish creates real schedules using stack outputs rather than manually supplied environment values.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation only after deployment-owned Google OAuth credentials exist.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The AgentCore Runtime invocation boundary is now represented in Step Functions and code, but the actual `AWS::BedrockAgentCore::Runtime` resource/code artifact/execution-role stack is still a deployment milestone.
- The SES SDK transport exists, but a real trusted user-email resolver is still required before production email can be configured. Missing resolver is explicit `NOT_CONFIGURED`.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Live OpenAI/SES/AgentCore validation remains pending the controlled AWS environment; CI uses deterministic fakes and never requires user credentials.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
