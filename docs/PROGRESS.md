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

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `b5b8501304f4274c909fad4b9ec90436752650de` is green on GitHub Actions CI #158.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — AWS SES SDK + reporting deployment composition

### Product slice

Added the concrete production binding from the existing sanitized SES notification port to the official AWS SDK v3 SES v2 client. `AwsSesV2SendEmailTransport` maps one already-sanitized plaintext notification into one `SendEmailCommand`; recipient discovery remains outside the transport and continues to use a deployment-owned, tenant/user-scoped `SesRecipientResolver`.

Added `createAwsScheduledRunReporting`, the deployment composition boundary for scheduled-run telemetry and email. CloudWatch EMF telemetry remains configured by default from low-cardinality namespace/service values. Email becomes `CONFIGURED` only when `AUTOMATION_SES_FROM_EMAIL`, an AWS region, and a trusted recipient resolver are all available. Otherwise the composition returns an explicit `NOT_CONFIGURED` email state while telemetry and execution remain usable; it never guesses an address from Cognito `sub`.

Added `infra/aws/observability-notifications.yaml` with least-privilege `ses:SendEmail` permission scoped to the verified sender identity, an operational SNS topic, dispatch-DLQ depth alarm, scheduled-run failure and human-attention alarms using the existing low-cardinality EMF dimensions, and a CloudWatch dashboard for outcome counts and DLQ depth.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- SES delivery remains best-effort reporting only. A mail outage cannot mutate run/checkpoint state or trigger browser/model replay.
- Recipient email is resolved from trusted ownership context; scheduled payloads still cannot select arbitrary destinations.
- The sender identity is deployment configuration. Raw BYOK keys, workload tokens, cookies, browser state, raw provider failures, and evidence content are not added to email or telemetry.
- IAM grants only `ses:SendEmail` on the configured verified sender identity rather than broad SES permissions.
- CloudWatch custom metrics keep only `Service` + `Outcome` dimensions; tenant/user/automation/run IDs remain log fields, avoiding high-cardinality metric amplification.
- DLQ and outcome alarms surface transport/execution degradation without adding retries beyond the existing Scheduler/SQS/Step Functions and workflow budgets.
- The new direct dependency `@aws-sdk/client-sesv2` is pinned to the existing AWS SDK alignment line (`3.1111.0`). This intentionally changes the pnpm dependency graph; the deterministic lock gate must expose and authenticate the new exact graph before the lock hash is updated.
- Browser verification, schedule idempotency, automation locking, BYOK selection, and human recovery are unchanged.

### Tests added

Regression coverage proves:

- sanitized notification fields map to exactly one SES v2 `SendEmailCommand`,
- malformed SES regions fail before SDK invocation,
- missing sender/region/resolver produces explicit email `NOT_CONFIGURED` while EMF telemetry still reports the run,
- configured reporting resolves the owner through the trusted resolver and sends to that destination through SES,
- no change to the existing cross-user rejection boundary in `AwsSesNotificationPort`.

### Validation status

- Implementation, tests, dependency declaration, exports, IaC, and this progress update are being published as one normal CI-triggering Git-data commit.
- Because `@aws-sdk/client-sesv2` changes the reviewed dependency graph, the first CI run is expected to stop at the deterministic lock-snapshot gate with a new SHA-256. That failure is a supply-chain review boundary, not permission to bypass the gate. One corrective commit may update only the reviewed snapshot and any separately root-caused CI defect.
- Exact-head GitHub Actions remains authoritative; no green result is claimed until it exists.

## Next product milestones

1. Compose the actual scheduled-run worker/bootstrap from stack outputs: DynamoDB repositories, Browser/Browser Profile, AgentCore Identity vault, OpenAI reasoner, trusted invocation scope/runtime headers, and the reporting composition added here.
2. Add a trusted user-directory/email resolver backed by authenticated control-plane data or Cognito administration data; never derive an email by guessing from `sub`.
3. Compose the control-plane Lambda handler from Cognito/API Gateway verified claims and existing control-plane HTTP service, with explicit deployment `NOT_CONFIGURED` states where backing stores are absent.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation only after deployment-owned Google OAuth credentials exist.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The trusted scheduled handler and reporting composition exist, but the final deployed worker bootstrap that constructs all DynamoDB/Browser/Identity dependencies from stack outputs remains the main execution deployment seam.
- The SES SDK transport exists, but a real trusted user-email resolver is still required before production email can be configured. Missing resolver is explicit `NOT_CONFIGURED`.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Live OpenAI/SES/AgentCore validation remains pending the controlled AWS environment; CI uses deterministic fakes and never requires user credentials.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
