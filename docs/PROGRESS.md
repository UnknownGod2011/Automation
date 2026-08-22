# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical slices remain available in Git; this file is intentionally consolidated around the current production state and the latest product-facing work.

## Product target

sign in with email or Google -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product-facing recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Scheduled execution checkpoints are seeded before browser startup from immutable graph variables, bounded persisted non-secret scheduled capture inputs, and any explicit invocation override.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `661d26651b13dc3af2fbd7c13019088ab6198e3a` (`Add optional Google sign-in federation`) is green on GitHub Actions CI #223.
- This run fixes Google-federated email verification propagation needed by the existing trusted SES recipient resolver. GitHub Actions on the exact outgoing head remains authoritative; no pass is claimed until that run completes successfully.

## 2026-08-22 — preserve Google email verification for notifications

The live-deployment audit found a concrete integration defect in the new Google federation path. Cognito mapped Google's `email` claim but not its `email_verified` claim. AWS documents that mapped federated email addresses are unverified by default unless verification status is explicitly mapped from the external IdP. The production notification recipient resolver intentionally rejects unverified Cognito email addresses, so a Google user could sign in successfully yet fail to receive the run-success, run-failure, or human-attention email promised by the product lifecycle.

`infra/aws/control-plane-auth.yaml` now maps `email_verified: email_verified` from Google into the Cognito user profile alongside the existing email/name mappings. This preserves the trust boundary rather than weakening the resolver to accept unverified addresses. Native Cognito email sign-in remains unchanged.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** notification routing still requires a verified Cognito email. The fix propagates Google's verification claim instead of bypassing verification or trusting an address from the scheduled payload.
- **Tenant isolation:** unchanged. Cognito `sub` remains the trusted user identifier and tenant identity remains deployment-owned; the email directory lookup is still scoped to that identity.
- **Idempotency/concurrency:** identity-provider attribute mapping is deployment configuration only and has no run/browser execution authority.
- **Retry/timeout:** unchanged. No new application retry loop, timeout, browser call, model call, or queue is introduced.
- **Side-effect verification:** unchanged. Workflow effect verification remains authoritative for automation success.
- **Cost:** no additional steady-state AWS resource or request is added; the existing Cognito user record simply contains its federated verification status.
- **Observability:** scheduled and human-resume SES/CloudWatch reporting can now use the same trusted directory path for Google users as native Cognito users without exposing provider tokens.
- **User recovery:** a Google-authenticated owner can receive the existing bounded failure/human-attention notifications instead of silently losing that recovery signal.

### Validation added

- The no-cloud Cognito Google federation contract now requires `email_verified: email_verified` exactly once in the IdP mapping.
- Existing checks still require the conditional Google IdP, exact OAuth scopes, native Cognito support, Secrets Manager dynamic-reference boundary, and absence of a plaintext Google client-secret parameter.
- Exact-head GitHub Actions must still pass deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment/demo/OIDC contracts, and the complete test suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
2. If Google sign-in is part of the demo, create the Google OAuth client and Secrets Manager secret, deploy with only its client ID + secret ARN, and verify the resulting federated Cognito user has both `email` and `email_verified=true` before relying on SES notification evidence.
3. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> fresh test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
4. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
5. If the demo genuinely requires a recurring secret typed value outside target-site authentication, add a distinct vault-reference runtime-input contract; never place the secret itself in scheduled plaintext inputs.
6. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates the infrastructure contract but cannot prove a live external OAuth exchange without those deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
