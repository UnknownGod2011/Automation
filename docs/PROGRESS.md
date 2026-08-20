# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed foundation

- Strict TypeScript/pnpm monorepo with versioned workflow/run/failure contracts, bounded retries, verification, checkpointing, occurrence idempotency, tenant ownership, and in-memory adapters.
- Deep provider-neutral execution/human-recovery substrate: durable human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Deterministic dependency bootstrap using pinned Node 22.23.2, pnpm 10.15.0, and a reviewed lock SHA-256. The known DynamoDB/lib-dynamodb peer mismatch was resolved rather than suppressed.
- Versioned capture trace contracts and `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, explicit verification, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history UX with same-origin mutation checks.
- AWS transport/IaC define EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login now protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- `AgentCoreIdentityCredentialVault` already stores BYOK API keys as AgentCore Identity managed API-key credential providers and resolves them at runtime only with a workload identity token. Raw provider keys stay out of normal application metadata.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `c433b0320e550374fdbb4f86a3b92fb123487f69` is green on GitHub Actions CI #150.

## 2026-08-20 — Provider-neutral BYOK credential pool + reasoning routing

### Product slice

Added the provider-neutral layer that was missing above the existing AgentCore Identity vault.

`ProviderCredentialService` now registers a BYOK credential through `CredentialVault`, stores only provider/priority/health plus the opaque vault reference in `CredentialMetadataRepository`, and returns a sanitized summary that never contains the raw API key or `secretRef`. API-key bytes are treated as opaque input and are not normalized before secure storage.

`selectProviderCredential` implements deterministic provider preference and health-aware selection. Provider order is explicit and case-insensitive; within a provider, lower priority wins, then lower failure count, then credential ID. `HEALTHY`/`UNKNOWN` credentials are usable, and expired `COOLDOWN` credentials become eligible again. `DISABLED`, `EXHAUSTED`, malformed cooldown state, and active cooldowns are unavailable.

Same-provider key rotation is **off by default**. If the highest-priority key for a provider is unavailable, the pool moves to the next configured provider rather than silently trying another key for the same provider. Same-provider fallback exists only behind the explicit `allowSameProviderCredentialFailover` policy flag; deployments must not use it to evade provider quotas or rate limits.

`CredentialPoolReasoningProvider` resolves the selected secret only for the reasoning invocation, optionally supplies the workload identity context required by AgentCore Identity, creates a provider-specific reasoner behind a factory interface, and never persists the secret or workload token. Successful calls mark the credential healthy. Authentication failures disable it, quota exhaustion marks it exhausted, and rate-limit/transient failures place it into a bounded cooldown. The failing call is never automatically replayed against another credential.

`CredentialPoolPreflightCheck` can be inserted into the existing scheduled-run coordinator so a run with no usable BYOK credential pauses before browser/model compute rather than opening a cloud browser and failing later.

### Security / tenancy / idempotency / concurrency / retry / cost review

- All credential metadata reads/writes remain scoped by the existing tenant/user repository contracts. The AWS AgentCore vault separately validates that opaque secret references belong to the same ownership scope.
- Raw API keys exist only in the registration request and ephemeral `CredentialSecret` passed to the provider factory. Returned summaries, normal metadata, warnings, and run failures contain no key material.
- Workload identity tokens are runtime access capability material and are passed only to `CredentialVault.get`; they are never written into credential metadata.
- Credential selection is deterministic for a fixed metadata snapshot and timestamp. This adds no external browser side effect and no run-idempotency surface.
- Health metadata writes are advisory rather than execution authority. If a health update fails after a model call, the reasoning decision/failure remains authoritative; only a fixed sanitized warning hook is emitted. This avoids repeating model calls solely because health bookkeeping failed.
- The router does not perform same-call failover. This avoids duplicate model cost and prevents automatic key rotation from becoming rate-limit circumvention.
- Preflight rejection happens before browser startup, reducing wasted AgentCore Browser and model spend when credentials are unavailable.

### Tests

Added regression coverage for:

- default suppression of same-provider key rotation,
- explicit same-provider fallback policy,
- sanitized credential registration with tenant isolation,
- runtime-only secret resolution and success health updates,
- workload identity context reaching only the vault boundary,
- invalid-auth disablement without same-call alternate-key replay,
- preflight blocking when the primary provider has no usable credential,
- bounded cooldown after provider rate limiting.

### Validation status

- This is the single normal CI-triggering multi-file commit for this run.
- No dependency was added; the existing AgentCore Identity SDK adapters are reused.
- GitHub Actions on the exact resulting head is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the full test suite complete successfully.

## Next product milestones

1. Expose sanitized BYOK credential create/list/rotate/remove operations through the authenticated control-plane API and minimal Next.js settings UX, then compose `CredentialPoolPreflightCheck` and `CredentialPoolReasoningProvider` into the AWS scheduled-run worker with a workload identity token source.
2. Add concrete provider-bound reasoners for the supported BYOK providers behind `CredentialBoundReasoningProviderFactory`; preserve the provider-neutral workflow/runtime contract and bounded provider timeouts.
3. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states.
4. Compose/deploy the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions stack behind explicit environment outputs.
5. Perform one controlled real AWS demonstration covering sign-in -> capture -> compile/test -> publish -> scheduled cloud browser execution -> verification/history and one bounded human takeover/resume path.
6. Add Google federation to Cognito once a deployment-owned Google OAuth client is available; do not hard-code or store those credentials in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive runtime values for target-site workflows still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The BYOK core service is not yet exposed through the public authenticated control-plane/Next.js UX, and production AWS worker composition does not yet source the AgentCore workload identity token for the router.
- Credential health metadata currently has no compare-and-set generation; concurrent reasoning calls may race health bookkeeping. Health is advisory, not execution authority, so this cannot duplicate browser effects, but a later credential-management slice should add versioned/conditional health updates if concurrent provider selection becomes material.
- Public HTTP command idempotency, production rate limiting beyond API Gateway throttles, and deployment-level capture-worker authentication middleware remain required control-plane work.
- Cognito refresh currently refreshes server-side on demand when the short-lived access cookie is absent; Server Components cannot rotate the cookie during render, so repeated page renders after access expiry can repeat refresh calls until a Route Handler writes a new access cookie. This is safe but not cost-optimal.
- Real AWS credentials are not available in CI, so AWS SDK composition/auth boundaries are validated with deterministic tests; live deployment validation remains a later environment gate.
