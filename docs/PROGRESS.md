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
- AWS transport/IaC define EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- `AgentCoreIdentityCredentialVault` stores BYOK API keys as AgentCore Identity managed API-key credential providers. Raw provider keys stay out of normal application metadata.
- Provider-neutral credential-pool routing and authenticated credential settings support deterministic BYOK selection, runtime-only secret resolution, health/cooldown policy, and sanitized create/list/rotate/remove operations.
- AWS scheduled execution composes BYOK preflight and runtime-only AgentCore workload-token secret access before browser/model work.
- `OpenAiCredentialBoundReasoningProviderFactory` provides the first concrete BYOK reasoner using the fixed OpenAI Responses endpoint, Structured Outputs, local policy revalidation, bounded network/context/output limits, and sanitized provider failures.
- `AwsScheduledRunHandler` binds trusted occurrence scope, AgentCore workload token, deterministic occurrence run ID, OpenAI BYOK reasoning, browser execution, and durable reporting.
- `ScheduledRunOutcomeReporter`, CloudWatch EMF telemetry, and the ownership-scoped SES notification port report success/failure/attention without becoming execution authority.
- `createAwsScheduledRunBootstrap` now assembles the concrete AWS scheduled execution dependency graph from deployment configuration: DynamoDB state/locks/credential metadata, immutable S3 workflow documents and evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, and SES/EMF reporting.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `c5badb4a8f8387a9e9f48004aa2e8fd1da8fc7b6` is green on GitHub Actions CI #160.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — Production scheduled-run bootstrap composition

### Product slice

Added `createAwsScheduledRunBootstrap`, the concrete dependency-composition boundary for one production scheduled-run host process. It consumes the existing deployment environment contracts and constructs the previously separate production adapters into one `AwsScheduledRunHandler`: DynamoDB automation/run/checkpoint/lock repositories, DynamoDB credential metadata, immutable S3 workflow documents, tenant-scoped S3 evidence, AgentCore Browser Profile lookup, AgentCore browser sessions, Playwright/CDP execution and verification, AgentCore Identity BYOK retrieval, OpenAI BYOK reasoning, and best-effort SES/CloudWatch reporting.

Mandatory execution configuration is aggregated before handler construction. Missing AWS region, DynamoDB state table, artifact bucket, or OpenAI BYOK model returns one explicit `NOT_CONFIGURED` result. Optional SES remains independent: lack of sender configuration or a trusted recipient resolver does not make execution unavailable and does not disable EMF telemetry.

The composition supports narrow deterministic overrides for SDK-facing ports and the execution runner so CI can prove dependency wiring without cloud credentials. Production defaults still instantiate the concrete AWS adapters and rely on the standard AWS credential provider chain at call time; raw AWS credentials are not added to this environment contract.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- The bootstrap introduces no new execution state machine or retry layer. Scheduled occurrence idempotency, automation locking, workflow retry budgets, side-effect verification, and durable run/checkpoint state remain owned by the existing core services.
- Tenant/user authorization remains enforced at the scheduled handler and every durable repository/profile/secret boundary. The bootstrap does not accept caller-selected browser-profile or AgentCore Identity references.
- BYOK defaults to the explicit `openai` provider order with same-provider credential failover disabled. Deployment code may supply another explicit provider-neutral pool policy, but the bootstrap does not rotate keys to evade limits.
- One DynamoDB document client is shared across the state repositories for a bootstrap instance. S3, AgentCore, Playwright, and reporting adapters are likewise constructed once for the handler graph; deployment wrappers should reuse the bootstrap across warm invocations rather than rebuilding it per workflow node.
- Browser evidence remains tenant-scoped S3 data and typing actions still avoid screenshot capture. Workflow definitions remain immutable S3 documents anchored by DynamoDB metadata.
- AgentCore workload access tokens and raw BYOK keys are still invocation-only secret material. This bootstrap does not persist, log, or expose either capability.
- Reporting remains best-effort and non-authoritative. SES or EMF failure cannot mutate run/checkpoint state or cause browser/model replay.
- No package dependency changed, so the reviewed pnpm dependency graph should remain unchanged. CI still authenticates it before frozen installation.
- A deployment host seam remains explicit: the current scheduling IaC invokes a Lambda worker directly, while `AwsScheduledRunHandler` expects the trusted AgentCore Runtime `WorkloadAccessToken` header. Production deployment must route execution through AgentCore Runtime, or introduce a separate trusted workload-token acquisition/forwarding boundary; a user-controlled scheduled payload must never supply this capability.

### Tests added

Regression coverage proves:

- all mandatory execution configuration gaps are aggregated into one fail-closed `NOT_CONFIGURED` result,
- the complete production adapter graph can be constructed without live AWS credentials or network calls,
- optional SES configuration remains independent from execution readiness,
- malformed AgentCore browser-session configuration is rejected rather than normalized.

### Validation status

- Incoming head `c5badb4a8f8387a9e9f48004aa2e8fd1da8fc7b6` is confirmed green on CI #160.
- Implementation, tests, export surface, and this progress update are published as one normal CI-triggering Git-data commit.
- No dependency manifest is changed, so a lock-snapshot refresh is not expected.
- Exact-head GitHub Actions remains authoritative; no green result for this slice is claimed until it exists.

## Previous milestone — AWS SES SDK + reporting deployment composition

`AwsSesV2SendEmailTransport` maps one already-sanitized notification into the official SES v2 send boundary. `createAwsScheduledRunReporting` exposes explicit configured/not-configured email state while CloudWatch EMF remains usable, and `infra/aws/observability-notifications.yaml` provides least-privilege SES send permission, DLQ/run-outcome alarms, and a low-cardinality operational dashboard. The reviewed SES dependency graph is pinned and incoming CI #160 is green.

## Next product milestones

1. Close the execution-host seam: wire Step Functions to the actual AgentCore Runtime invocation boundary (or a justified trusted workload-token acquisition boundary) so `AwsScheduledRunHandler` receives an authentic runtime workload token without putting it in the schedule/SQS payload.
2. Add the execution-state/artifact/worker IAM and deployment outputs needed by the bootstrap, with least-privilege DynamoDB, S3/KMS, AgentCore Browser/Profile/Identity, and Runtime invoke permissions.
3. Add a trusted user-directory/email resolver backed by authenticated control-plane data or Cognito administration data; never derive an email by guessing from `sub`.
4. Compose the control-plane Lambda handler from Cognito/API Gateway verified claims and the existing control-plane HTTP service, with explicit deployment `NOT_CONFIGURED` states where backing stores are absent.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation only after deployment-owned Google OAuth credentials exist.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The scheduled worker dependency graph is now composed, but the execution host still must supply a trusted AgentCore Runtime workload token; the existing direct-Lambda Step Functions task does not itself establish that capability boundary.
- The SES SDK transport exists, but a real trusted user-email resolver is still required before production email can be configured. Missing resolver is explicit `NOT_CONFIGURED`.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Live OpenAI/SES/AgentCore validation remains pending the controlled AWS environment; CI uses deterministic fakes and never requires user credentials.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
