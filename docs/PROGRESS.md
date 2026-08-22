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
- Incoming head `34e7dc1583cc13105d1f0c525292e82afd4d1a3d` (`Fix strict Fresh Test input typing`) is green on GitHub Actions CI #227.
- This slice changes production cloud Fresh Test from a synchronous AgentCore Runtime request to an acknowledged background Runtime task so the API Lambda/HTTP API request does not need to remain open for the duration of browser/model execution.
- GitHub Actions on the exact new head is authoritative. No pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — decouple cloud Fresh Test from the control-plane HTTP timeout

The live-deployment audit found a concrete vertical-path blocker: `AwsAgentCoreFreshTestExecutionPort` synchronously awaited the complete AgentCore browser/model test, but the production control-plane Lambda is bounded to 29 seconds and its API Gateway HTTP API integration is bounded to 30 seconds. A valid browser workflow can easily exceed that duration, causing the user-facing request to fail even while the execution plane is healthy.

Production Fresh Test submission now has an explicit `ACCEPTED` result. The control plane sends the authenticated test request to AgentCore Runtime and returns as soon as Runtime has accepted the stable server-owned run identity. The Runtime host starts the existing `AwsFreshTestRunHandler` as a background task, while durable run/checkpoint creation, automation locking, BYOK preflight, browser execution, verification, and final `READY_TO_PUBLISH` transition remain owned by the existing execution path. Local/mock Fresh Test remains synchronous for deterministic tests and development.

The Runtime keeps a process-local map keyed by a tenant/user-scoped opaque fresh-test task identity to suppress duplicate task starts in one Runtime process. That map is not execution authority: replacement/concurrent Runtime processes still converge through the existing durable run occurrence key and automation lease. The Runtime returns only `{ kind: "ACCEPTED", runId }`; tenant IDs, workload tokens, BYOK material, Browser Profile references, and provider/browser errors are not returned.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the acceptance response contains only the server-created run ID already used by the authenticated product flow. Tenant identity and the AgentCore workload token remain out of the payload/response, and detached task failures emit only a fixed event name.
- **Tenant isolation:** Runtime user identity still comes from AgentCore's trusted `runtimeUserId`; the configured tenant is checked before invocation, and the background-task key includes the trusted ownership scope.
- **Idempotency/concurrency:** identical submissions use the same Runtime session/task identity. Process-local duplicate suppression reduces duplicate work, while the durable `automation:test:runId` occurrence key and automation lock remain the cross-process authority.
- **Retry/timeout:** no new execution retry is added. The API request is now short-lived; browser/model work continues under the Runtime's existing long-running execution timeout, bounded workflow retries, and lease renewal.
- **Side-effect verification:** unchanged. The same immutable workflow and verification-before-success rules run inside the existing Fresh Test handler.
- **Cost:** the change prevents API/Lambda timeouts from causing unnecessary user resubmission. Process-local duplicate suppression also avoids obvious same-container duplicate execution attempts.
- **Observability:** Runtime health reports busy while either capture collection or Fresh Test background tasks are active. Detached failures log only a fixed `fresh_test_task_failed` event; durable run diagnostics remain the authoritative user-visible state.
- **User recovery:** a submission acknowledgement is not treated as test success. Publication still requires a durable successful `FRESH_TEST` run for the latest immutable workflow version.

### Validation added

- AWS unit coverage requires the cloud Fresh Test port to accept the new acknowledgement shape and reject an acknowledgement for a different run ID.
- Coverage verifies stable Runtime session/background-task identities and cross-tenant rejection before AgentCore invocation.
- The AgentCore Runtime production host now routes `FRESH_TEST` requests into the background task path and includes those tasks in `HealthyBusy` health state.
- Existing full CI remains required, including AgentCore Runtime packaging; this ensures the modified host and compiled AWS exports are present in the deployable ZIP.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> durable Fresh Test execution/result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
2. Exercise a Fresh Test that intentionally runs longer than 30 seconds and verify the web/control-plane request returns promptly while the durable run continues to completion in AgentCore Runtime.
3. If Google sign-in is part of the demo, create the Google OAuth client and Secrets Manager secret, deploy with only its client ID + secret ARN, complete one real Google sign-in, then run `scripts/verify-google-demo-user.sh` before relying on SES evidence.
4. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
5. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
6. If the demo genuinely requires a recurring secret typed value outside target-site authentication, add a distinct vault-reference runtime-input contract; never place the secret itself in scheduled plaintext inputs.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain the cross-process authority. Harden only if live Runtime replacement demonstrates a concrete duplicate-start defect.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates the infrastructure and verification tooling but cannot prove a live external OAuth exchange without deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
