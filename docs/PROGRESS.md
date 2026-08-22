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
- Optional Google federation preserves `email_verified` into Cognito so the existing trusted SES recipient resolver does not need to weaken its verification requirement.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `a3ab424c53bd8e605d9ee42d3f28287e09deeaf1` (`Preserve Google email verification`) is green on GitHub Actions CI #224.
- This run adds a live, read-only operator verification for the actual Google-federated Cognito user before SES notification evidence is trusted. GitHub Actions on the exact outgoing head remains authoritative; no pass is claimed until that run completes successfully.

## 2026-08-22 — verify live Google federation notification readiness

CI already proves the Cognito Google IdP maps `email_verified`, but deterministic template validation cannot prove a real federated user record was created with the expected provider linkage and verified-email state. That matters because the production SES resolver intentionally refuses unverified Cognito email addresses.

`scripts/verify-google-demo-user.sh` now provides a bounded read-only check for the controlled AWS vertical demo. It consumes the immutable deployment result plus the signed-in user's email, resolves only the deployed Cognito User Pool ID, performs one filtered `ListUsers` lookup, and succeeds only when exactly one enabled user matches the requested email, has `email_verified=true`, and carries a Google identity-provider link. It deliberately does not print the Cognito subject, provider tokens, Google tokens, OAuth credentials, BYOK material, Browser Profile state, or any execution capability.

The demo runbook now requires this check after the first successful Google sign-in and before Google-backed SES notification evidence is trusted. Native Cognito email sign-in remains unchanged.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the command is read-only and validates a bounded plain email before any AWS call, preventing filter injection. It never accepts or prints authentication tokens or Cognito `sub` values.
- **Tenant isolation:** tenant identity is still deployment-owned. This operator check is scoped to the exact deployed user pool and has no application execution authority.
- **Idempotency/concurrency:** repeated verification is side-effect free. Ambiguous duplicate user matches fail closed rather than guessing which record should receive notifications.
- **Retry/timeout:** no application retry loop changes. AWS CLI/network failures propagate as verification failure; they are not converted into notification readiness.
- **Side-effect verification:** workflow effect verification is unchanged. This verifies only notification-recipient readiness for the live demo.
- **Cost:** one CloudFormation output read and one bounded Cognito `ListUsers` query when the operator explicitly runs the check.
- **Observability/privacy:** success output is fixed and does not echo the email, subject ID, identities payload, or secret-bearing data.
- **User recovery:** Google-authenticated users can be validated before relying on SES attention/recovery messages, making a missing verification mapping a visible deployment defect instead of a silent notification failure.

### Validation added

- New `scripts/test-verify-google-demo-user.sh` uses a fake AWS CLI and proves success for one enabled Google-linked verified user.
- Negative coverage rejects unverified email, native/non-Google identity, ambiguous matches, and malformed email before any AWS call.
- CI runs the new contract alongside the existing Cognito federation, packaging, release, deployment, live-smoke, OIDC, type/build, and full test gates.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
2. If Google sign-in is part of the demo, create the Google OAuth client and Secrets Manager secret, deploy with only its client ID + secret ARN, complete one real Google sign-in, then run `scripts/verify-google-demo-user.sh` before relying on SES evidence.
3. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> fresh test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
4. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
5. If the demo genuinely requires a recurring secret typed value outside target-site authentication, add a distinct vault-reference runtime-input contract; never place the secret itself in scheduled plaintext inputs.
6. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates the infrastructure and verification tooling but cannot prove a live external OAuth exchange without deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
