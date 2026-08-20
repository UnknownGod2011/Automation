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
- Provider-neutral credential-pool routing selects usable BYOK credentials deterministically, resolves secrets only at model invocation, applies bounded health/cooldown state, suppresses same-provider rotation by default, and supports preflight rejection before browser/model cost.
- Authenticated credential-management APIs and `/settings/credentials` support sanitized create/list/rotate/remove operations while keeping raw keys and vault references server-side.
- AWS scheduled execution composes BYOK preflight and runtime-only AgentCore workload-token secret access before browser/model work.
- `OpenAiCredentialBoundReasoningProviderFactory` provides the first concrete BYOK reasoner using the fixed OpenAI Responses endpoint, Structured Outputs, local policy revalidation, bounded network/context/output limits, sanitized provider failures, and no OpenAI SDK dependency.
- `AwsScheduledRunHandler` binds the trusted Step Functions occurrence scope, AgentCore workload token, deterministic occurrence run ID, concrete OpenAI BYOK factory, and the production scheduled worker path.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `4432e020c31fd62edaae75307fc39c2ee642d316` is green on GitHub Actions CI #157.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — Scheduled-run notifications and structured observability

### Product slice

Added a provider-neutral `ScheduledRunOutcomeReporter` around the durable scheduled-run result boundary. It converts the authoritative worker result/checkpoint into one bounded telemetry event and, when configured, a user notification. Reporting is intentionally outside workflow execution policy: it cannot change run state, verification, retry, checkpoint, locking, or browser/model ownership.

The reporter classifies outcomes as `SUCCEEDED`, `FAILED`, `NEEDS_ATTENTION`, `SKIPPED`, or `DUPLICATE`. Duplicate and skipped deliveries do not send user email. Success email respects `notifyOnSuccess`; failed email respects `notifyOnFailure`; `WAITING_FOR_HUMAN` remains an operational attention condition and is surfaced even when ordinary failure email is disabled. Authentication and provider-credential blockers map to the existing `AUTH_REQUIRED` / `API_KEY_REQUIRED` notification kinds.

`AwsScheduledRunHandler` now optionally invokes the reporter after scheduled execution. For a preflight `BLOCKED` result it loads the durable checkpoint so the reporter sees the authoritative failure code rather than guessing from a user-facing string. Trusted ownership is still validated before reporting metadata is loaded.

Added `AwsCloudWatchEmfTelemetryPort`, which emits CloudWatch Embedded Metric Format JSON through the runtime log stream. Correlation fields include tenant/user/automation/run/workflow identifiers, status, scheduled timestamp, optional node/failure code, cleanup-warning count, and bounded duration. Only `Service` and `Outcome` are metric dimensions; high-cardinality identifiers stay ordinary structured fields to avoid metric-cardinality cost growth.

Added `AwsSesNotificationPort`, a tenant-scoped SES notification boundary. Recipient email is resolved server-side from the authenticated user identity through a deployment-owned resolver; the run command cannot choose an arbitrary email address. The adapter validates sender/destination/subject/body bounds and forwards only the sanitized notification message to an injected SES transport. The final deployment wrapper must bind this transport to the official AWS SES SDK and bind the recipient resolver to trusted user identity data.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- Reporting consumes final durable run/checkpoint state and never acts as execution authority.
- Notification/telemetry delivery failures are best-effort: they return fixed warnings and never reinterpret a successful run as failed or retry browser/model side effects.
- Raw failure messages, evidence content, cookies, browser state, API keys, workload tokens, lease owner tokens, and model prompt data are excluded from telemetry and email construction. Only stable failure codes are surfaced.
- Duplicate scheduled delivery is observable but does not generate another user email, preventing normal Scheduler/SQS redelivery from spamming the owner.
- The SES adapter rejects cross-user routing before recipient lookup or transport invocation.
- CloudWatch EMF dimensions intentionally exclude tenant/user/automation/run IDs to avoid high-cardinality custom-metric cost amplification; those values remain searchable log correlation fields.
- This slice adds no package dependency and therefore should not change the reviewed pnpm lock snapshot. The SES SDK binding remains part of deployment composition rather than introducing a dependency before the user-identity email resolver exists.
- Browser action verification, bounded workflow retries, occurrence idempotency, automation locking, BYOK secret access, and human-recovery semantics are unchanged.

### Tests added

Regression coverage proves:

- success telemetry and `notifyOnSuccess` behavior,
- human-attention notification even when ordinary failure email is disabled,
- raw failure/evidence data exclusion from telemetry and email,
- duplicate-delivery email suppression,
- reporting-outage warnings are sanitized and non-authoritative,
- cross-tenant reporting context rejection,
- CloudWatch EMF uses low-cardinality dimensions while retaining correlation fields,
- SES destination resolution is ownership-scoped and rejects cross-user or malformed recipients,
- the scheduled handler reports the durable preflight checkpoint after a `BLOCKED` occurrence and performs no reporting lookup before trusted-scope validation.

### Validation status

- No package manifest or lock snapshot changed.
- Implementation, tests, exports, handler integration, and this progress update are published as one normal CI-triggering Git-data commit.
- Exact-head GitHub Actions remains authoritative. A corrective commit is permitted only if CI exposes a concrete defect that is root-caused from Actions logs.

## Next product milestones

1. Compose the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/SQS/Step Functions/AgentCore execution stack behind explicit environment/IaC outputs, including the trusted invocation scope and runtime headers consumed by `AwsScheduledRunHandler`.
2. Bind `AwsSesNotificationPort` to the official AWS SES SDK and a trusted Cognito/user-email resolver in that deployment composition; expose explicit `NOT_CONFIGURED` state when sender identity/email resolution is unavailable.
3. Add CloudWatch alarms/dashboard signals for DLQ depth, scheduled-run failure/attention rate, browser/runtime errors, and provider availability without high-cardinality custom metrics.
4. Perform one controlled real AWS demonstration covering sign-in -> credential setup -> capture -> compile/test -> publish -> scheduled cloud browser execution -> OpenAI BYOK reasoning -> verification/history/email and one bounded human takeover/resume path.
5. Add Google federation to Cognito once deployment-owned Google OAuth credentials are available; never hard-code them in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The trusted scheduled handler exists, but the final deployed AgentCore/Lambda wrapper that constructs DynamoDB/Browser/Identity/reporting adapters from stack outputs remains the main deployment-composition milestone.
- SES transport and recipient resolution are explicit ports in this slice; live AWS SES SDK/Cognito resolver composition is intentionally deferred to the deployment wrapper so user email cannot be guessed from Cognito `sub`.
- Live OpenAI provider and SES validation are still pending the controlled AWS environment/demo; CI uses deterministic fakes and never requires user credentials.
- Gemini/other concrete provider adapters are intentionally deferred until the first real OpenAI-backed vertical slice is deployed; core contracts do not require redesign for them.
- Credential health metadata has no compare-and-set generation; concurrent reasoning calls may race advisory health bookkeeping. It is not execution authority and cannot duplicate browser effects.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Notification delivery is currently best-effort rather than durable/outboxed. This may lose an email during an SES outage, but intentionally does not trigger execution replay; add durable notification retry only if the real deployment demonstrates the need.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
