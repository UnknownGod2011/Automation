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
- Incoming head `fed8daa3f92b25b4a32d19c9455a033cf5cafe07` (`Sanitize automation run history`) is green on GitHub Actions CI #222.
- This run adds optional Google federation to the Cognito deployment while retaining native email sign-in. GitHub Actions on the exact outgoing head remains authoritative; no pass is claimed until that run completes successfully.

## 2026-08-22 — optional Google federation for production sign-in

The end goal promises Google or email sign-in, but the deployed Cognito app client previously configured only `COGNITO`. The product could therefore satisfy email/password sign-in but not the first user-journey requirement for Google federation.

`infra/aws/control-plane-auth.yaml` now supports an optional Google social IdP. Native Cognito email sign-in remains enabled unconditionally. Google is enabled only when both `GoogleClientId` and `GoogleClientSecretArn` are configured; a CloudFormation rule rejects a partial pair. The Google OAuth client secret is never a plaintext stack parameter. CloudFormation resolves it directly from Secrets Manager through a versionless dynamic reference when creating `AWS::Cognito::UserPoolIdentityProvider`.

The ordinary deployment JSON contains only the non-secret Google client ID and Secrets Manager ARN. Deployments that omit both values remain valid and continue to expose email-only managed login, so cloud credentials are not required for CI/local validation and existing environments do not break.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the Google OAuth client secret stays out of Git, GitHub environment JSON, CloudFormation parameter values, Lambda environment variables, app tables, and logs. The deploy principal needs scoped `secretsmanager:GetSecretValue` only when federation is enabled.
- **Tenant isolation:** unchanged. Federation only changes the upstream Cognito authentication method; trusted application ownership still derives user identity from the verified Cognito `sub` and tenant identity from deployment configuration.
- **Idempotency/concurrency:** CloudFormation remains the single deployment authority. Re-applying the same IdP/client configuration is a normal stack update and does not create application runs or browser effects.
- **Retry/timeout:** no application retry loop or timeout changes. Identity-provider provisioning failure leaves stack deployment failed rather than silently falling back from a requested Google configuration.
- **Side-effect verification:** unchanged. Authentication configuration has no workflow execution authority.
- **Cost:** no new steady-state compute. Enabling Google adds one Cognito user-pool identity-provider resource plus the separately managed Secrets Manager secret.
- **Observability:** `GoogleFederationEnabled` is exposed as a non-secret stack output for deployment evidence. Secret values are never emitted.
- **User recovery:** if Google federation is unavailable, native Cognito email sign-in remains available only when Google was not requested. A requested-but-invalid Google configuration fails deployment instead of creating a misleading partial login path.

### Validation added

- New no-cloud CI contract checks the conditional Google IdP, the exact Google scopes, preservation of native Cognito sign-in, Secrets Manager dynamic-reference boundary, and absence of a plaintext Google client-secret parameter.
- CI now runs that contract alongside the existing packaging, release, deployment, demo, OIDC, type, and test gates.
- Deployment documentation records the Secrets Manager setup and the extra least-privilege deploy-role permission required only for Google federation.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
2. If Google sign-in is part of the demo, create the Google OAuth client and Secrets Manager secret, then deploy with only its client ID + secret ARN in the protected environment JSON.
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
