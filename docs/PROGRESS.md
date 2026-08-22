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
- Optional Google federation preserves `email_verified` into Cognito, and the controlled demo includes a read-only check for one Google-linked verified Cognito user before SES evidence is trusted.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `bbac0d4ed3d4c302a939aa54c1d4ad515df9d08d` (`Verify live Google notification identity`) is green on GitHub Actions CI #225.
- Normal implementation head `76c8fd22bc74fd98e00cc25fae577944b472cdd0` reached deterministic lock verification and frozen installation successfully, then CI #226 failed strict web type-checking because the parser intentionally returned `undefined` for “no inputs required” while its return annotation omitted `undefined`. Production behavior was not implicated.
- The single corrective commit changes only that return contract plus this validation record. GitHub Actions on the exact corrective head remains authoritative; no pass is claimed until it completes successfully.

## 2026-08-22 — restrict Fresh Test runtime input to captured requirements

The live-demo path still exposed a product/security seam: workflow inspection deliberately reveals only unresolved compiler-generated `capture_input_N` placeholders, but the Fresh Test form accepted an arbitrary JSON object and forwarded every key as a runtime variable. A normal user should not need or be able to guess internal binding names, and a tampered browser form should not be able to inject unrelated workflow variables through the product UX.

The authenticated web mutation route now reloads the latest trusted workflow inspection before starting a fresh test. `parseFreshTestRuntimeInputForm` accepts only the exact unresolved `capture_input_N` keys required by that workflow. Missing keys, additional/forged keys, malformed JSON, non-string values, duplicate form fields, malformed trusted requirements, values over 4,096 characters, or aggregate values over 32,768 characters fail before the cloud fresh-test command is sent. When the compiled workflow requires no capture input, a blank field or `{}` remains valid but arbitrary variables are rejected.

The lower-level provider-neutral fresh-test API still supports explicit runtime variables for trusted programmatic callers. This change intentionally narrows only the human-facing Next.js product form, which already shows the exact privacy-safe capture placeholders and JSON example in the semantic workflow inspection.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the browser can no longer use the Fresh Test form to submit arbitrary workflow variable names; only trusted workflow-inspection `capture_input_N` requirements are accepted. Raw values remain per-run checkpoint material and are not added to automation summaries, logs, emails, or metrics.
- **Tenant isolation:** the allowed-key set comes from `client.workflow(automationId)` under the authenticated Cognito-derived scope. Tenant/user identity is still never taken from the form.
- **Idempotency/concurrency:** the server still creates a unique fresh-test run ID for each intentional submission. A workflow changed between page render and submit is re-read server-side, so stale input shapes fail closed instead of targeting an older graph implicitly.
- **Retry/timeout:** no retry layer or timeout changed. Invalid input is rejected before AgentCore Browser/model execution.
- **Side-effect verification:** unchanged. The same immutable workflow and verification contracts remain authoritative once a fresh test starts.
- **Cost:** one workflow-inspection read is added to an intentional Fresh Test submission; invalid/malformed submissions are stopped before cloud execution cost.
- **Observability/privacy:** no new metric dimension or log payload is introduced. Values are deliberately absent from diagnostics and notifications.
- **User recovery:** invalid or stale Fresh Test input returns the existing bounded `invalid-input` UX rather than creating a cloud run with unintended variables.

### Validation added

- New web unit coverage accepts the exact required capture-input set and intentionally empty string values.
- Negative tests reject missing/extra keys, arbitrary names when no inputs are required, malformed JSON, non-string values, duplicate fields, malformed/duplicate trusted requirements, per-value overflow, and aggregate overflow.
- CI #226 root cause was a strict TypeScript return-annotation mismatch only: `undefined` was an intentional value for “no inputs required” but missing from the declared union. The corrective change adds it explicitly; no runtime behavior or compiler setting is weakened.
- Exact-head GitHub Actions must still pass deterministic lock verification, frozen install, strict type/Next.js build checks, all production packaging/deployment/demo/OIDC contracts, and the complete test suite.

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
