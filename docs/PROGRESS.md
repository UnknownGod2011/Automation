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
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history and authenticated BYOK credential UX.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- AgentCore Identity-backed BYOK plus authenticated credential settings keep raw provider keys outside ordinary metadata tables and select credentials through a deterministic provider-neutral pool.
- OpenAI BYOK reasoning uses the fixed Responses API endpoint, structured output, local policy revalidation, bounded context/network/output limits, and sanitized failure classification.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard provides buffered at-least-once scheduling with occurrence-derived idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- `AwsScheduledRunHandler` binds trusted occurrence scope, AgentCore workload identity, deterministic occurrence run identity, OpenAI BYOK reasoning, browser execution, and durable outcome reporting.
- SES/CloudWatch reporting records sanitized success/failure/attention outcomes without becoming execution authority.
- `createAwsScheduledRunBootstrap` assembles DynamoDB state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, and reporting.
- Step Functions invokes AgentCore Runtime rather than a browser Lambda. The Runtime is packageable as a Node 22 direct-code artifact and provisioned by `infra/aws/agentcore-runtime.yaml` with bounded compute lifetime and least-privilege execution access.
- Cognito-backed scheduled notification recipient resolution uses the trusted user `sub`, verified email, and deployment-owned user-pool configuration; scheduled payloads cannot select destinations.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `8c687623502abd81f434ddf89f2c82cf3d2fe9cc` is green on GitHub Actions CI #166.
- GitHub Actions on the exact new head created by this run is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, AgentCore package smoke testing, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — API Gateway control-plane Lambda transport

### Product slice

Closed the missing transport/authentication boundary between the deployed API Gateway HTTP API and the existing provider-neutral `AutomationControlPlaneHttpHandler`.

Added `createAwsControlPlaneLambdaHandler`, a dependency-free AWS adapter for API Gateway HTTP API payload format 2.0. It accepts only the already-verified JWT authorizer claim context, resolves the trusted tenant/user through the existing Cognito adapter, normalizes GET/POST path/body input into the core HTTP contract, and maps the sanitized core response back to the Lambda proxy response shape.

The adapter deliberately does not parse or verify raw bearer tokens. API Gateway remains the cryptographic JWT/scope boundary. Tenant identity remains deployment-owned and user identity remains the Cognito access-token `sub`; request JSON and extra claims cannot override either.

Request handling is bounded and fail-closed: unsupported methods/payload versions and malformed paths/JSON are rejected before core dispatch, decoded bodies are capped at 1 MiB, base64 payloads are decoded without adding Node-specific type dependencies, and unexpected adapter/core failures are converted to a fixed sanitized 500 response. Responses include `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

This slice intentionally does not duplicate `AutomationControlPlaneService` logic or create a second routing implementation. The next composition layer can inject the real DynamoDB/S3/AgentCore/scheduler-backed service into the same core handler and then hand that handler to this Lambda transport.

### Correctness / security / tenancy / idempotency / retry / timeout / cost / observability review

- Authentication is resolved before parsing/dispatching an application request, so unauthenticated calls cannot reach DynamoDB, S3, AgentCore Browser, Identity, or Scheduler adapters through this boundary.
- Ownership is derived from deployment tenant + verified Cognito `sub`; spoofed `tenantId`/`userId` fields and claims do not influence scope.
- Raw Authorization headers/tokens are not accepted by this adapter and therefore are not copied into application logs or errors.
- Body size is bounded before JSON parsing to cap Lambda memory/CPU exposure from oversized requests. API Gateway/Lambda still provide the outer transport timeout; no application retry loop was added.
- This transport does not add execution authority or side-effect retries. Existing command/service idempotency and workflow verification rules remain authoritative.
- Error responses are fixed/sanitized; provider exceptions, BYOK material, browser-profile/session identifiers, and secret-bearing DOM data are not reflected.
- No new dependency, AWS SDK client, persistent table, metric dimension, or cloud call was introduced, so dependency graph and steady-state cloud cost are unchanged.
- `NOT_CONFIGURED` remains explicit when Cognito issuer/client/tenant deployment configuration is absent rather than constructing a partially authenticated handler.

### Tests / validation

Regression coverage now proves:

- incomplete Cognito deployment configuration returns `NOT_CONFIGURED`,
- verified access-token claims map to the trusted provider-neutral ownership scope while spoofed ownership fields are ignored,
- payload-format 2.0 POST/JSON and base64-encoded JSON map correctly into the core handler,
- invalid identity is rejected before core dispatch,
- malformed JSON, unsupported HTTP methods, invalid paths, and unsupported payload versions fail closed,
- oversized request bodies are rejected before core dispatch,
- unexpected handler failures produce a fixed sanitized 500 without reflecting secret-bearing error text.

Validation status for this slice: implementation, tests, AWS package export, and this progress update are being published as one normal CI-triggering Git-data commit. Exact-head GitHub Actions is authoritative; no pass is claimed here until it exists.

## Next product milestones

1. Compose the concrete production `AutomationControlPlaneService` graph behind this Lambda transport: DynamoDB automation/run state, S3 workflow/capture artifacts, AgentCore Browser/Profile capture starter, capture completion state, AgentCore Identity credential management, and the real Scheduler port, with aggregated `NOT_CONFIGURED` deployment state.
2. Wire publish/update/disable lifecycle operations to the deployed EventBridge Scheduler resources automatically, using stack outputs for dispatch queue/role/group rather than manual environment assembly.
3. Add the Runtime artifact upload/deploy release command around the tested ZIP, requiring a versioned S3 object in production.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The API Gateway Lambda transport is now defined, but the concrete cloud-backed `AutomationControlPlaneService` dependency graph and deployable Lambda resource/package remain the next control-plane milestone.
- Trusted capture-completion worker authentication remains a separate deployment boundary; it must not be exposed through the ordinary end-user JWT route.
- The Runtime resource/package is represented in code/IaC, but live creation and invocation still require a controlled AWS deployment and uploaded Runtime ZIP; CI intentionally uses no cloud credentials.
- `PUBLIC` Runtime networking is suitable for the arbitrary-web MVP but should be revisited for production environments that can provide VPC egress without breaking permitted target-site access.
- Cognito directory reads are eventually consistent, so notification delivery for a just-created account can be delayed; execution remains unaffected.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Live OpenAI/SES/Cognito/AgentCore validation remains pending the controlled AWS environment; deterministic CI tests are not represented as live-cloud proof.
