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
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- `AgentCoreIdentityCredentialVault` stores BYOK API keys as AgentCore Identity managed API-key credential providers and resolves them at runtime only with a workload identity token. Raw provider keys stay out of normal application metadata.
- Provider-neutral credential-pool routing selects usable BYOK credentials deterministically, performs runtime-only secret resolution, applies bounded cooldown/health state, suppresses same-provider rotation by default, and supports preflight rejection before browser/model cost.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `26a0e0d6d0b14e6080a6dcb6111df8ce81232b2c` is green on GitHub Actions CI #151.

## 2026-08-20 — Authenticated BYOK credential management

### Product slice

Made the existing BYOK pool usable from the authenticated product instead of leaving it as an execution-only core primitive.

Added provider-neutral `ProviderCredentialManagementService` and `ProviderCredentialManagementPort` for create/list/rotate/remove operations. Public results reuse the existing sanitized `ProviderCredentialSummary`; raw API keys and opaque `secretRef` values are never returned. Create rejects an already-used credential ID rather than silently treating a management request as rotation. Rotation preserves provider, label, priority, tenant/user ownership, and the existing vault reference while resetting stale health/cooldown state to `UNKNOWN` so the replacement key is re-evaluated on its next use.

Rotation requires the vault adapter to return the same opaque reference for the same credential ID. This is true for the existing AgentCore Identity adapter, whose provider name is deterministically derived from tenant/user + credential ID. If another vault changes the reference during rotation, the newly-created reference is removed and the metadata transition is rejected rather than orphaning the old metadata pointer.

Removal revokes the vault secret before deleting normal metadata. If metadata deletion subsequently fails, the safer residual state is stale metadata pointing at a revoked secret; retrying removal remains safe. A missing credential is an idempotent no-op.

Credential deletion authority is intentionally narrower than ordinary health/routing metadata access: the generic `CredentialMetadataRepository` contract remains unchanged, while management uses an extended `CredentialManagementMetadataRepository`. This avoids granting deletion capability to reasoning components that only need list/get/health writes.

Added `AwsDynamoCredentialMetadataRepository` using the existing tenant/user DynamoDB partition scheme and the shared state table. Reads used for a specific credential and management lists are strongly consistent, embedded ownership/identity is validated before returning records, listing is paginated and deterministically ordered, and delete is scoped to the authenticated partition. No raw API key is ever written to DynamoDB.

`AutomationControlPlaneService` now accepts an optional credential-management port. When it is absent, credential routes fail explicitly as `NOT_CONFIGURED`. The authenticated HTTP API now exposes:

- `GET /v1/credentials`
- `POST /v1/credentials`
- `POST /v1/credentials/:credentialId/rotate`
- `POST /v1/credentials/:credentialId/remove`

All ownership comes from `AuthenticatedControlPlaneContext.scope`; tenant/user fields in JSON have no authority.

The request-scoped Next.js control-plane client now supports those routes. Authenticated users have `/settings/credentials` with sanitized list/health state plus add, rotate, and remove forms. API-key form fields are password inputs, mutation handlers keep the established same-origin requirement, and the navigation exposes Credentials only for an authenticated session. Missing control-plane/credential configuration remains an explicit unavailable state instead of using local placeholder secrets.

### Security / tenancy / idempotency / concurrency / retry / cost review

- Raw keys cross only the authenticated mutation request and `CredentialVault.put`; they are not written to DynamoDB, workflow graphs, run records, browser profiles, logs, or returned summaries.
- Credential secret references remain server-side. The control plane and settings page expose only credential ID, provider, masked label, health, priority, cooldown, last-success timestamp, and failure count.
- Tenant/user isolation is enforced in the service repositories and again when DynamoDB records are decoded. Request bodies cannot override authenticated scope.
- Remove is secret-first and idempotent after completion. Partial metadata cleanup cannot leave an active provider secret accidentally available through the deleted management entry.
- Rotate is one explicit management action, not provider failover. It never automatically retries a failed reasoning call and therefore does not create rate-limit/quota circumvention behavior.
- Credential health remains advisory execution metadata. This slice deliberately does not add recovery/outbox machinery around it.
- DynamoDB credential operations are control-plane scale and use strongly consistent reads for correctness. They do not open AgentCore Browser/model sessions, so management failures do not create browser side effects or model cost.
- Public management mutation idempotency under repeated user form submission is bounded by credential identity and stable AgentCore reference behavior, but a formal HTTP idempotency-key contract is still pending for control-plane commands generally.

### Tests

Added regression coverage for:

- sanitized tenant-scoped create/list behavior and duplicate create rejection,
- stable-reference rotation plus health/cooldown reset,
- rejection/cleanup when a vault changes the reference during rotation,
- secret-first deletion ordering and idempotent repeated removal,
- authenticated HTTP scope precedence over spoofed tenant/user body fields,
- raw-key/secret-ref suppression in HTTP responses,
- cross-tenant credential-list isolation,
- AWS DynamoDB tenant isolation, deterministic listing, delete behavior, and corrupted embedded-ownership rejection,
- authenticated web-client routing for credential list/rotate/remove with encoded IDs.

### Validation status

- This is the single normal CI-triggering multi-file commit planned for this run.
- No dependency or lock snapshot change is required; existing core, AWS SDK, Cognito, and Next.js dependencies are reused.
- GitHub Actions on the exact resulting head is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the full test suite complete successfully.

## Next product milestones

1. Compose `CredentialPoolPreflightCheck` and `CredentialPoolReasoningProvider` into the concrete AWS scheduled-run worker and add a workload-identity-token source for AgentCore Identity; then add concrete provider-bound reasoners behind `CredentialBoundReasoningProviderFactory` with bounded provider timeouts.
2. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states and run correlation identifiers.
3. Compose/deploy the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions stack behind explicit environment outputs.
4. Perform one controlled real AWS demonstration covering sign-in -> credential setup -> capture -> compile/test -> publish -> scheduled cloud browser execution -> reasoning -> verification/history and one bounded human takeover/resume path.
5. Add Google federation to Cognito once a deployment-owned Google OAuth client is available; do not hard-code or store those credentials in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive runtime values for target-site workflows still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- Production AWS worker composition does not yet source the AgentCore workload identity token or route reasoning through the new credential pool end-to-end.
- Concrete provider-bound reasoners are not yet wired behind `CredentialBoundReasoningProviderFactory`; the pool/router contract is ready for them.
- Credential health metadata currently has no compare-and-set generation; concurrent reasoning calls may race health bookkeeping. Health is advisory, not execution authority, so this cannot duplicate browser effects.
- Credential create/update metadata writes and vault writes are separate authorities. Stable AgentCore references make rotation deterministic; a future persistence composition may add explicit create transaction cleanup if live fault injection shows orphan-resource risk.
- Public HTTP command idempotency, production rate limiting beyond API Gateway throttles, and deployment-level capture-worker authentication middleware remain required control-plane work.
- Cognito refresh currently refreshes server-side on demand when the short-lived access cookie is absent; Server Components cannot rotate the cookie during render, so repeated page renders after access expiry can repeat refresh calls until a Route Handler writes a new access cookie. This is safe but not cost-optimal.
- Real AWS credentials are not available in CI, so AWS SDK composition/auth boundaries are validated with deterministic tests; live deployment validation remains a later environment gate.
