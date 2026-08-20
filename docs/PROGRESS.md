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
- AgentCore Identity-backed BYOK plus authenticated credential settings keep raw provider keys outside ordinary metadata tables and select credentials through a deterministic provider-neutral pool.
- OpenAI BYOK reasoning uses the fixed Responses API endpoint, structured output, local policy revalidation, bounded context/network/output limits, and sanitized failure classification.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard provides buffered at-least-once scheduling with occurrence-derived idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- `AwsScheduledRunHandler` binds trusted occurrence scope, AgentCore workload identity, deterministic occurrence run identity, OpenAI BYOK reasoning, browser execution, and durable outcome reporting.
- SES/CloudWatch reporting records sanitized success/failure/attention outcomes without becoming execution authority.
- `createAwsScheduledRunBootstrap` assembles DynamoDB state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, and reporting.
- Step Functions invokes AgentCore Runtime rather than a long-lived browser Lambda. Tenant scope is deployment-owned; Runtime user identity is supplied separately from scheduled JSON and revalidated by the scheduled handler.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `70f1665bd8ac9e8abd1d0041216bd496c1a2eea9` is green on GitHub Actions CI #163.
- GitHub Actions on the exact new head created by this run is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, the AgentCore package smoke test, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — deployable AgentCore Runtime host

### Product slice

Added the concrete runtime deployment boundary that was missing behind the existing Step Functions `InvokeAgentRuntime` task.

`packages/aws/runtime-http.mjs` is now the Node 22 managed-runtime process. It implements AgentCore Runtime's required `GET /ping` and `POST /invocations` HTTP contract on port 8080, bounds invocation bodies to 1 MiB, accepts JSON only, exposes no raw worker/provider exceptions, and gives long browser/model invocations a bounded one-hour HTTP request timeout. A missing production configuration makes `/ping` unhealthy instead of pretending the worker is deployable.

`createAwsAgentCoreScheduledRuntimeInvocationFromHttp` converts managed Runtime HTTP headers into the existing scheduled-runtime invocation contract. Runtime user identity comes only from `X-Amzn-Bedrock-AgentCore-Runtime-User-Id`; the scheduled JSON still cannot establish ownership. Header normalization is case-insensitive, and ambiguous multi-valued/conflicting headers fail closed before a workload token can reach BYOK resolution.

`scripts/package-agentcore-runtime.sh` builds the contracts/core/AWS packages, uses pnpm's production deploy boundary to create a portable dependency tree, adds the Runtime HTTP entrypoint, and creates a ZIP without uploading it anywhere. CI now smoke-packages that ZIP after `pnpm check`; the package is kept only on the ephemeral runner, so this adds no retained GitHub Actions artifact storage.

`infra/aws/agentcore-runtime.yaml` provisions `AWS::BedrockAgentCore::Runtime` using direct Node 22 code deployment from S3, supports an optional immutable S3 object VersionId, exports the Runtime ARN/ID/version, and supplies only the deployment configuration needed by `createAwsAgentCoreScheduledRuntime`. The execution role is scoped to the configured DynamoDB table/indexes, artifact prefix, exact browser resource plus account browser profiles, managed automation API-key providers/workload identity resources, runtime code object, optional artifact KMS key, browser automation stream, and AgentCore Runtime logs.

The execution role intentionally does not grant `GetWorkloadAccessToken*`: current AgentCore Runtime uses its service-linked Runtime Identity role to mint/deliver the invocation workload token. The application receives that token only at the Runtime request boundary and passes it in memory to the existing AgentCore Identity vault.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- Runtime request ownership is a two-source boundary: tenant from `AUTOMATION_TENANT_ID`, user from the managed Runtime header. The scheduled envelope must match both in the existing handler before browser or BYOK work starts.
- Workload tokens, raw provider keys, browser cookies/profile contents, and provider/browser error bodies are never reflected by the HTTP host. Unexpected invocation failures return one fixed sanitized error.
- The HTTP host adds no execution retry. Step Functions still has no outer `InvokeAgentRuntime` retry, so uncertainty around a browser side effect cannot create a second whole-run attempt. Existing occurrence idempotency, workflow retry budgets, verification, checkpoints, and automation locks remain authoritative.
- Direct-code artifacts can be pinned to an S3 VersionId so a deployment is reproducible and immutable. Runtime package smoke testing happens in CI but the ZIP is not retained as a GitHub Actions artifact.
- `PUBLIC` Runtime networking is currently deliberate because arbitrary permitted target websites and the OpenAI BYOK endpoint need egress. Invocation remains IAM-controlled. A production VPC/NAT profile can replace this later when deployment networking is known; do not add a VPC merely to satisfy a generic hardening preference at the expense of product reachability.
- Runtime idle/max-lifetime inputs are bounded to AgentCore's supported 60..28800-second range. AgentCore additionally validates idle timeout <= max lifetime at deployment. The default 300s idle / 3600s max lifetime bounds idle compute cost while supporting the current scheduled-run timeout envelope.
- Browser permissions are resource-scoped wherever AgentCore exposes a resource type. `ConnectBrowserAutomationStream` remains `Resource: '*'` because the current service authorization reference does not expose a resource type for that action.
- `GetResourceApiKey` is read-only and limited to account-local AgentCore token-vault/workload-identity resources, with API-key provider names constrained to the platform's `automation_*` naming boundary. Credential create/update/delete remain control-plane responsibilities and are not granted to the scheduled runtime.
- DynamoDB and S3 access are limited to the state table and configured artifact namespace. Optional KMS use is explicitly scoped to the configured key.
- No dependency manifest changed in this slice, so the reviewed deterministic pnpm graph should remain unchanged.

### Tests / validation

Regression coverage now checks case-insensitive managed Runtime user-ID extraction, workload-token forwarding, and fail-closed handling for multi-valued/conflicting Runtime headers, in addition to the existing trusted-scope/missing-config/oversized-user tests.

CI now includes a production-package smoke step so a TypeScript-green repository cannot silently ship a Runtime ZIP missing `runtime-http.mjs`, compiled AWS entrypoint, package metadata, or production dependencies.

Validation status for this slice: implementation, tests, IaC, package script, CI gate, and this progress log are being published as one normal CI-triggering Git-data commit. Exact-head GitHub Actions is authoritative; no pass is claimed here until that run completes successfully.

## Next product milestones

1. Add a trusted user-directory/email resolver backed by authenticated control-plane/Cognito data; never derive an email by guessing from Cognito `sub`.
2. Compose the control-plane Lambda/API handler from API Gateway verified Cognito claims and the existing provider-neutral control-plane service, with explicit deployment `NOT_CONFIGURED` states for missing stores/adapters.
3. Wire stack outputs together so publish creates real EventBridge schedules using the deployed Runtime/SQS/Step Functions resources rather than manually supplied environment values.
4. Add the runtime artifact upload/deploy release command around the now-tested ZIP, ideally requiring a versioned S3 object in production.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The Runtime resource is now represented in code/IaC, but live creation and invocation still require a controlled AWS deployment and uploaded Runtime ZIP; CI intentionally uses no cloud credentials.
- `PUBLIC` Runtime networking is suitable for the current arbitrary-web MVP but should be revisited for production environments that can provide VPC egress without breaking permitted target-site access.
- The SES SDK transport exists, but a real trusted user-email resolver is still required before production email can be fully configured. Missing resolver remains explicit `NOT_CONFIGURED`.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Live OpenAI/SES/AgentCore validation remains pending the controlled AWS environment; deterministic CI tests are not represented as live-cloud proof.
