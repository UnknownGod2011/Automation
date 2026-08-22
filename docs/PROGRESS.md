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
- Incoming head `21f45d35b4a98f569f45c34286a2aabe265fc92a` (`Run cloud Fresh Tests asynchronously`) is green on GitHub Actions CI #228.
- This slice closes the UX gap introduced by asynchronous Fresh Test submission: the automation page now follows the durable Fresh Test state automatically until it reaches a terminal/attention result, including the brief acknowledgement-to-run-creation gap.
- GitHub Actions on the exact new head is authoritative. No pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — follow asynchronous Fresh Test results in the product UX

The preceding production change correctly decoupled cloud Fresh Test execution from the 29–30 second control-plane HTTP timeout by returning an AgentCore `ACCEPTED` acknowledgement while the durable test continued in the Runtime. The product page, however, still rendered one server snapshot after that acknowledgement. A legitimate >30 second test could therefore finish successfully in AgentCore while the user continued to see stale in-progress or even pre-run state until a manual refresh.

The automation detail page now polls only while the latest Fresh Test is genuinely in progress, or while a just-accepted submission has not yet become visible in durable run history. It refreshes every five seconds for at most five minutes, then stops with an explicit manual-refresh/diagnostics fallback. Once the durable run becomes `SUCCEEDED`, `WAITING_FOR_HUMAN`, `FAILED`, `CANCELED`, or `SKIPPED`, polling stops automatically and the existing correction/publish/human-attention UX becomes visible.

The Fresh Test form is also suppressed while that poll state is active. This avoids encouraging the user to create a second intentional Fresh Test merely because the first asynchronous run has not finished yet; cross-process execution safety still remains with the existing durable occurrence key and automation lock.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** polling contains no new identifiers, secrets, browser/profile state, BYOK material, or provider errors. It only re-renders the same authenticated sanitized automation/run views already available on the page.
- **Tenant isolation:** every refresh still executes through the Cognito-authenticated server control-plane client; no tenant/user identity moves into browser-supplied state.
- **Idempotency/concurrency:** no execution authority changes. The page merely observes durable state and suppresses an obvious duplicate-submit UX while a Fresh Test is active; run occurrence identity and the automation lease remain authoritative.
- **Retry/timeout:** no browser/model retry was added. UI polling is bounded to 60 attempts at five-second cadence and stops after five minutes.
- **Side-effect verification:** unchanged. A Fresh Test is still publishable only after the existing durable verification-before-success path returns `SUCCEEDED` for the latest immutable workflow.
- **Cost:** worst-case polling is bounded. Each refresh reuses the existing automation-detail reads; the five-second cadence is intentionally slower than capture-finalization polling because cloud browser/model tests are materially longer-running.
- **Observability:** users now see durable status transitions without having to infer whether the accepted request is still executing. Run diagnostics remain the detailed source of truth.
- **User recovery:** `WAITING_FOR_HUMAN` and failed Fresh Tests automatically surface their existing repair/correction path when the durable state changes; polling itself never retries execution.

### Validation added

- Web unit coverage proves polling starts for a running Fresh Test, covers the post-acknowledgement/pre-run visibility gap, stops for terminal/attention/correction states, and stays off on unrelated pages with no Fresh Test.
- Poll interval and maximum attempts are tested as bounded and long enough to cover the >30 second cloud-runtime scenario that motivated asynchronous submission.
- Next.js production build remains part of `pnpm check`, so the new client poller/server component integration must compile through the actual deployment build.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> automatically observed durable Fresh Test result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
2. Exercise a Fresh Test that intentionally runs longer than 30 seconds and verify the web/control-plane request returns promptly, the page automatically follows the durable run, and the final `SUCCEEDED`/attention result appears without manual refresh.
3. If Google sign-in is part of the demo, create the Google OAuth client and Secrets Manager secret, deploy with only its client ID + secret ARN, complete one real Google sign-in, then run `scripts/verify-google-demo-user.sh` before relying on SES evidence.
4. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
5. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
6. If the demo genuinely requires a recurring secret typed value outside target-site authentication, add a distinct vault-reference runtime-input contract; never place the secret itself in scheduled plaintext inputs.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain the cross-process authority. Harden only if live Runtime replacement demonstrates a concrete duplicate-start defect.
- Fresh Test page polling is bounded to five minutes; longer tests remain valid and can be followed through manual refresh/run diagnostics rather than keeping an unbounded browser polling loop alive.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates the infrastructure and verification tooling but cannot prove a live external OAuth exchange without deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
