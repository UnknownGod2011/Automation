# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed foundation

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
- AWS scheduled execution now composes BYOK preflight and runtime-only AgentCore workload-token secret access before browser/model work.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `da7d29f9f1442900ce3eb354a0c4dd3ecee6380c` is green on GitHub Actions CI #154.
- GitHub Actions on the exact new head created by this run is authoritative; do not claim the new slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — OpenAI BYOK reasoning adapter

### Product slice

Added the first concrete provider-bound BYOK reasoner behind the existing provider-neutral `CredentialBoundReasoningProviderFactory`. The implementation lives in the AWS deployment adapter package because that is the current production execution composition, while all workflow/credential-pool contracts remain provider-neutral.

`OpenAiCredentialBoundReasoningProviderFactory` accepts only metadata provider `openai` and binds the runtime-only secret resolved by `CredentialVault` into `OpenAiByokReasoningProvider`. No OpenAI SDK dependency was added; the adapter uses the Node 22 standards-based `fetch` surface and the official Responses API endpoint.

The request uses JSON-schema Structured Outputs and converts a bounded list of `{name,value}` argument pairs into the existing provider-neutral decision argument map. This avoids relying on arbitrary object properties in strict structured-output schemas while preserving the core `ReasoningDecision` contract.

### Security / tenancy / idempotency / concurrency / retry / verification / cost review

- The provider endpoint is fixed to `https://api.openai.com/v1/responses`; deployment configuration cannot redirect a user's stored API key to an arbitrary host.
- The API key exists only in the in-memory Authorization header created immediately before the provider call. It is not written to workflow graphs, DynamoDB, run/checkpoint state, browser profiles, evidence, logs, or returned errors.
- Ownership identifiers (`tenantId`, `userId`, `automationId`, `runId`) are deliberately excluded from the provider prompt. Only the node objective, node kind, allowed action boundary, and bounded untrusted browser context are sent.
- Requests set `store: false`, use a bounded model timeout, cap serialized browser context and response bytes, and cap output tokens.
- Browser/page context remains explicitly marked untrusted. Provider output is locally revalidated against the exact `allowedActions` list, primitive argument schema, duplicate-argument guard, confidence bounds, and summary bounds before the browser executor can consume it.
- Provider HTTP failures are sanitized and classified without persisting or surfacing raw provider response messages. 401/403 disable invalid credentials, `insufficient_quota` maps to exhausted quota, ordinary 429 maps to bounded cooldown/retry, and network/5xx/timeout failures are retryable transient failures under the existing workflow retry budget.
- The adapter never falls back to another credential after a failed call; existing credential-pool policy remains authoritative and therefore cannot be used to evade provider rate or billing limits.
- This slice adds one network call only when deterministic browser execution has already escalated to semantic reasoning; it does not increase ordinary deterministic browser cost.

### Tests added

Regression coverage proves:

- the fixed OpenAI Responses endpoint and structured-output request shape,
- tenant/user/automation/run identifiers are not included in the provider request,
- oversized browser context is rejected before any network call,
- out-of-policy actions and duplicate structured arguments fail closed,
- raw provider error text/API keys are not surfaced through classified errors,
- quota exhaustion is distinct from ordinary rate limiting,
- 5xx failures remain bounded retryable transient failures,
- the factory accepts OpenAI credentials and rejects unsupported providers.

### Validation status

- No package manifest or lock snapshot changed; no new third-party dependency was introduced.
- The implementation, tests, AWS export, and this progress update are intended to be published as one normal CI-triggering Git-data commit.
- Exact-head GitHub Actions remains the only authority for declaring the new slice green. One corrective commit is allowed only after a concrete CI failure is root-caused from Actions logs.

## Next product milestones

1. Wire the concrete OpenAI factory into the actual AgentCore/Lambda scheduled-run handler composition through explicit deployment environment (`OPENAI_BYOK_MODEL`) and add one handler-level fake integration proving schedule envelope -> BYOK reasoner -> browser worker composition without live credentials.
2. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states and stable run correlation identifiers.
3. Compose/deploy the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions execution stack behind explicit environment/IaC outputs.
4. Perform one controlled real AWS demonstration covering sign-in -> credential setup -> capture -> compile/test -> publish -> scheduled cloud browser execution -> reasoning -> verification/history and one bounded human takeover/resume path.
5. Add Google federation to Cognito once deployment-owned Google OAuth credentials are available; never hard-code them in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The scheduled BYOK composition still expects the trusted deployment/runtime adapter to construct it once per AgentCore invocation with the runtime-provided workload token; the actual Lambda/AgentCore handler composition remains a deployment milestone.
- The OpenAI BYOK adapter is implemented and testable without credentials, but live provider validation is still pending the controlled AWS environment/demo.
- Gemini/other concrete provider adapters are intentionally deferred until the first real OpenAI-backed vertical slice is deployed; core contracts do not require redesign for them.
- Credential health metadata has no compare-and-set generation; concurrent reasoning calls may race advisory health bookkeeping. It is not execution authority and cannot duplicate browser effects.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Real AWS credentials are not available in CI, so AWS service boundaries are validated with deterministic tests; live deployment remains an explicit later gate.
