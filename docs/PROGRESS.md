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
- Cognito/API Gateway trusted-claims bridge derives tenant/user ownership from deployment tenant + verified Cognito identity.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `2332b92b054267ef596d206f4bc8616e475330b0` is green on GitHub Actions CI #148.

## 2026-08-20 — End-to-end Cognito web session + protected API perimeter

### Product slice

Finished the browser-facing authentication boundary without adding a JWT verification dependency to the application. The Next.js app now uses Cognito managed login with the OAuth 2.0 authorization-code grant and PKCE. Sign-in state, PKCE verifier/state, access token, and refresh token are held only in `HttpOnly`, `Secure`, `SameSite=Lax`, host-only cookies. Browser JavaScript never receives the control-plane bearer token.

Added `apps/web/lib/cognito-session.ts` for fail-closed Cognito configuration, PKCE generation, bounded OAuth state, local-only return paths, authorization/logout URL construction, code exchange, token-response validation, and refresh. `apps/web/lib/server-auth.ts` resolves the current server-side session and creates a request-scoped `WebControlPlaneClient` from a Cognito access token. The legacy `AUTOMATION_CONTROL_PLANE_BEARER_TOKEN` environment seam is no longer loaded by the web client.

Added Next.js auth routes:

- `GET /api/auth/sign-in` creates PKCE state and redirects to Cognito.
- `GET /api/auth/callback` validates bounded state, exchanges the code server-side, stores tokens in secure cookies, and returns only to a sanitized same-site path.
- `POST /api/auth/sign-out` enforces same-origin mutation checks, clears local session cookies, and redirects through Cognito logout.

Dashboard/detail/mutation routes now require the request-scoped Cognito session. Signed-out users receive an explicit sign-in state; expired access tokens can be refreshed from the server-only refresh cookie. No tenant/user field is accepted from the browser as identity authority.

### API authorization correction

Changed the AWS trusted-claims adapter from Cognito ID-token authorization to **access-token** authorization. It now requires `token_use=access`, the expected Cognito `client_id`, verified issuer, and non-empty `sub`. This matches the production HTTP API boundary, where OAuth scope enforcement distinguishes access tokens from ID tokens before Lambda receives claims.

Added `infra/aws/control-plane-auth.yaml` to provision:

- email-based Cognito user pool,
- authorization-code-only public web client,
- managed-login domain,
- JWT-authorized API Gateway HTTP API,
- OAuth `openid` scope requirement on the protected default route,
- Lambda proxy integration/permission,
- bounded API throttling and detailed route metrics,
- outputs for the exact server environment contract.

Google federation is intentionally not fabricated without an external IdP client configuration; the current stack provides Cognito email sign-in and leaves Google federation as a deployment follow-up.

### Security / tenancy / idempotency / retry / cost review

- OAuth code exchange uses PKCE S256 and keeps authorization codes/tokens out of URL fragments and browser JavaScript.
- OAuth transaction state expires after 10 minutes; external/open return redirects are rejected.
- Access/refresh cookies are host-only, secure, HTTP-only, and same-site. No raw token is written to application tables or logs.
- API Gateway is the cryptographic signature/expiry/issuer/audience/scope boundary. The Lambda adapter consumes only already-verified claims and still validates Cognito token type/client/subject defensively.
- Tenant ownership remains deployment-derived; user ownership remains Cognito `sub`-derived. Request JSON cannot select another tenant/user.
- Auth failures occur before automation/browser/model side effects, so they add no workflow idempotency surface.
- Access-token refresh is bounded to one Cognito call when the access cookie is absent. No polling or background refresh was added. A future BFF/session store can reduce repeated refresh calls after expiry if traffic warrants it.
- API Gateway throttling is finite; provider failures surface as sanitized sign-in/session failures rather than credential detail.

### Tests

Added regression coverage for missing/insecure Cognito configuration, PKCE generation, OAuth transaction expiry, open-redirect rejection, authorization-code exchange, refresh-token exchange, malformed token responses, static-bearer-env removal, access-token-only claim resolution, wrong client/issuer/token type, spoofed ownership claims, and unconfigured identity behavior.

### Validation status

- This is the single normal CI-triggering multi-file commit for the run.
- GitHub Actions on the exact resulting head is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, Next.js build/type validation, and the full test suite complete successfully.

## Next product milestones

1. Implement BYOK credential-pool routing through AgentCore Identity/secrets with provider-neutral selection policy; raw provider keys must remain outside ordinary application tables and logs.
2. Add SES notifications plus CloudWatch/AgentCore observability for success/failure/attention states.
3. Compose/deploy the concrete control-plane Lambda + Cognito/API Gateway stack and scheduler/Step Functions stack behind explicit environment outputs.
4. Perform one controlled real AWS demonstration covering sign-in -> capture -> compile/test -> publish -> scheduled cloud browser execution -> verification/history and one bounded human takeover/resume path.
5. Add Google federation to Cognito once a deployment-owned Google OAuth client is available; do not hard-code or store those credentials in normal metadata.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive runtime values still need the planned secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- Public HTTP command idempotency, production rate limiting beyond API Gateway throttles, and deployment-level capture-worker authentication middleware remain required control-plane work.
- Cognito refresh currently refreshes server-side on demand when the short-lived access cookie is absent; Server Components cannot rotate the cookie during render, so repeated page renders after access expiry can repeat refresh calls until a Route Handler writes a new access cookie. This is safe but not cost-optimal.
- Real AWS credentials are not available in CI, so AWS SDK composition/auth boundaries are validated with deterministic tests; live deployment validation remains a later environment gate.
