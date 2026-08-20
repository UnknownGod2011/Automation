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

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `4c70e5df96f5383045e2d02b1a874cd7dbd523aa` is green on GitHub Actions CI #156.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — Trusted scheduled-run handler composition

### Product slice

Added `AwsScheduledRunHandler`, the missing trusted execution-plane boundary between a Step Functions scheduled occurrence and the existing AWS BYOK scheduled worker composition.

The handler accepts a decoded or JSON scheduled-dispatch envelope, a caller-established ownership scope, and AgentCore Runtime invocation headers. It validates the envelope through the existing provider-neutral parser, requires the envelope ownership to exactly match the trusted invocation scope, derives one deterministic run ID from tenant + user + automation + scheduled timestamp, binds the invocation-scoped `WorkloadAccessToken`, constructs the concrete OpenAI BYOK provider factory from `OPENAI_BYOK_MODEL`, and then invokes the existing `createAwsByokScheduledExecution` worker path.

`readAwsScheduledRunHandlerConfiguration` exposes missing `OPENAI_BYOK_MODEL` as an explicit `NOT_CONFIGURED` deployment state. It does not invent a default model or silently route to another provider.

### Correctness / security / tenancy / idempotency / concurrency / retry / verification / cost review

- The scheduled envelope is treated as data, not authorization. Tenant/user scope must match the separate trusted execution-plane scope before the handler composes secret access, browser compute, or model work.
- The AgentCore workload token is read only from invocation headers and stays inside the already-established runtime-only BYOK path. It is not added to the scheduled request, workflow graph, run/checkpoint state, metadata, browser profile, or response.
- `OPENAI_BYOK_MODEL` is deployment configuration only. Raw provider keys continue to resolve from AgentCore Identity immediately before reasoning.
- Run identity excludes Scheduler/SQS delivery IDs. Redelivery for the same tenant/user/automation/scheduled timestamp therefore converges on the same run ID and the coordinator's existing occurrence-idempotency authority.
- The handler does not add retries of its own. Scheduler/SQS/Step Functions transport retry policy and the worker's bounded node retry policy remain authoritative, avoiding layered unbounded retry amplification.
- Side-effect verification behavior is unchanged: successful browser advancement still requires the immutable node verification contract.
- No new dependency was added, so the reviewed pnpm dependency graph should remain unchanged.
- The new handler is intentionally a composition boundary rather than another execution engine. It reuses existing preflight, lock, Browser Profile, Playwright, reasoning, verification, checkpoint, and cleanup semantics.

### Tests added

Regression coverage proves:

- missing `OPENAI_BYOK_MODEL` is surfaced as `NOT_CONFIGURED`,
- JSON scheduled payloads bind to the trusted scope and AgentCore workload token,
- the concrete OpenAI factory receives the deployment-selected model,
- spoofed cross-tenant/user envelope ownership is rejected before execution composition,
- the same scheduled occurrence derives the same run identity independently of delivery identity.

### Validation status

- No package manifest or lock snapshot changed.
- The implementation, tests, AWS export, and this progress update are published as one normal CI-triggering Git-data commit.
- Exact-head GitHub Actions remains the authority for declaring this slice complete. One corrective commit is permitted only if Actions exposes a concrete defect and that defect is root-caused from the failing logs.

## Next product milestones

1. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states and stable run correlation identifiers, wired around the scheduled handler/worker boundary rather than inside workflow policy.
2. Compose the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions/AgentCore execution stack behind explicit environment/IaC outputs.
3. Add deployment wiring that supplies the trusted invocation scope and AgentCore Runtime headers to `AwsScheduledRunHandler`; do not derive trust from user-controlled payload fields.
4. Perform one controlled real AWS demonstration covering sign-in -> credential setup -> capture -> compile/test -> publish -> scheduled cloud browser execution -> OpenAI BYOK reasoning -> verification/history and one bounded human takeover/resume path.
5. Add Google federation to Cognito once deployment-owned Google OAuth credentials are available; never hard-code them in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The trusted scheduled handler now exists, but the final deployed AgentCore/Lambda wrapper that constructs all DynamoDB/Browser/Identity adapters from stack outputs remains a deployment-composition milestone.
- Live OpenAI provider validation is still pending the controlled AWS environment/demo; CI uses deterministic fakes and never requires user credentials.
- Gemini/other concrete provider adapters are intentionally deferred until the first real OpenAI-backed vertical slice is deployed; core contracts do not require redesign for them.
- Credential health metadata has no compare-and-set generation; concurrent reasoning calls may race advisory health bookkeeping. It is not execution authority and cannot duplicate browser effects.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
