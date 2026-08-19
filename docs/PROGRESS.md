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
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history UX with server-only control-plane credentials and same-origin mutation checks.
- AWS transport/IaC define EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard with occurrence-based duplicate suppression, bounded delivery retries, DLQ/backpressure, tenant-scoped schedule identities, and least-privilege roles.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `d79f65733baf954f0f3018b3ad2c78b753cfb999` has CI #146 red on one strict TypeScript AWS Scheduler SDK response-shape mismatch. The deterministic lock gate and frozen install passed on that run; no green claim is made for the incoming head.

## 2026-08-20 — Scheduler typing correction + Cognito trusted identity bridge

### Correctness repair

Replaced the hand-written structural `SchedulerGetResponse` facade with the official `GetScheduleCommandOutput` SDK type. Runtime validation remains fail-closed through `requiredString`, `requiredInteger`, explicit state checks, required target/retry-policy checks, and not-found-only normalization. This fixes the `exactOptionalPropertyTypes` defect exposed by CI #146 without weakening strictness or adding a cast around an incompatible provider response.

### Product slice: Cognito/API Gateway authorization boundary

Added `cognito-auth.ts` in the AWS adapter package. It consumes only JWT claims that an API Gateway JWT authorizer has already verified and converts them into the provider-neutral `AuthenticatedControlPlaneContext` used by the existing HTTP handler.

Deployment contract:

- `AWS_COGNITO_ISSUER`
- `AWS_COGNITO_APP_CLIENT_ID`
- `AUTOMATION_TENANT_ID`

Missing values return an explicit unconfigured result; no credentials or fake identity are created. `userId` is derived only from Cognito `sub`. `tenantId` is deployment-owned rather than accepted from request JSON or a mutable user attribute, so callers cannot select another ownership partition. The bridge defense-in-depth checks issuer, app-client audience, `token_use=id`, and a non-empty subject even though API Gateway remains the cryptographic JWT verification boundary.

The adapter intentionally does not parse or verify raw bearer tokens itself. Signature, key rotation, expiry, issuer, and audience validation stay at API Gateway; the Lambda/control-plane layer receives verified claims only. This avoids duplicating JWT cryptography and keeps raw tokens out of application-domain APIs.

### Security / tenancy / idempotency / cost / recovery review

- No bearer token, refresh token, password, cookie, provider key, browser-profile identifier, or target-site credential is persisted or logged by the new bridge.
- Request bodies and user-controlled claims cannot override deployment tenant ownership or Cognito `sub` user ownership.
- Authentication happens before domain commands, so failed identity validation cannot create automations, schedules, runs, or browser sessions and therefore has no idempotency or external-side-effect surface.
- The bridge adds no cloud calls, polling, browser/model compute, or per-request storage cost; API Gateway/Cognito verification cost remains outside this pure adapter.
- Existing local/mock mode remains unaffected and can continue to provide an explicit `LOCAL_MOCK` capability state.

### Tests

Added regression coverage for missing deployment configuration, valid trusted claims, spoofed ownership claims, audience arrays, wrong issuer/audience, access-token rejection, missing subject, and configured/unconfigured resolver construction.

### Validation status

- This is the single normal CI-triggering multi-file commit for the run.
- GitHub Actions on the exact resulting head is authoritative. Do not treat this slice as complete until lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the full test suite are green.

## Next product milestones

1. Wire Cognito sign-in/redirect/logout in the Next.js app and API Gateway authorizer/IaC so the temporary server bearer seam can be removed end-to-end rather than only at the backend identity bridge.
2. Implement BYOK credential-pool routing through the secure AgentCore Identity/secret boundary; raw provider keys must remain outside ordinary application tables and logs.
3. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states.
4. Perform one controlled real AWS demonstration covering publish -> scheduled dispatch -> cloud browser execution -> verification/history and one bounded human takeover/resume path.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive runtime values still need the planned secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- Public HTTP command idempotency, production rate limiting, and deployment-level capture-worker authentication middleware remain required control-plane work.
- Cognito claim resolution is now implemented, but the Next.js login/session exchange and API Gateway authorizer resources are not yet wired; the existing server bearer integration seam therefore remains until the next product slice.
- Real AWS credentials are not available in CI, so AWS SDK composition/auth boundaries are validated with deterministic tests; live deployment validation remains a later environment gate.
