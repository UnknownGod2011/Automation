# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Detailed historical slices remain available in Git; this file is intentionally consolidated around the current production state and latest product-facing work.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product-facing recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation, with recurrence kind and expression shape kept consistent.
- Workflow inspection exposes only unresolved compiler-generated `capture_input_N` keys, never captured typed values or arbitrary application binding names.
- Scheduled execution checkpoints are seeded before browser startup from immutable graph variables, bounded persisted non-secret scheduled capture inputs, and any explicit invocation override.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `3b86b7a4bc1640d0391769984230b251c73ea6ba` (`Fix strict scheduled checkpoint typing`) is green on GitHub Actions CI #218.
- GitHub Actions on the exact outgoing head remains authoritative. No pass is claimed until that exact-head run completes successfully.

## 2026-08-22 — durable non-secret scheduled inputs for captured typing

The vertical-path audit found the remaining product gap behind privacy-preserving captured typing. Production capture intentionally never persists a raw typed value and emits unresolved `capture_input_N` bindings instead. Fresh Test can supply those values per run, but a published recurring automation previously had no durable value source. A workflow could therefore pass Fresh Test and still enter a real scheduled occurrence without the value needed by its TYPE node.

Publishing now has an explicit scheduled runtime-input boundary for these compiler-generated capture bindings. The workflow derives the exact unresolved `capture_input_N` set from the immutable graph. If any are required, publication fails before Scheduler activation unless every required key has a bounded string value and the caller explicitly acknowledges that those values are non-secret. Extra keys, non-string values, oversized values, and missing values fail closed.

The resulting `scheduledNonSecretInputs` live on the tenant/user-owned automation record and are deliberately omitted from sanitized control-plane summaries. They are ordinary configuration, not a secret store. The authenticated Next.js publish form shows the required synthetic keys, requires explicit acknowledgement, and warns that passwords, OTPs, API keys, tokens, and other secrets must not be entered. Target-site authentication remains in the Browser Profile; provider credentials remain in the AgentCore Identity/BYOK vault.

`ScheduledRunCoordinator` validates the published workflow against the persisted scheduled input set before browser/profile/model work. It then seeds checkpoints in this precedence order: immutable graph `initialVariables` -> persisted scheduled non-secret inputs -> explicit invocation runtime variables. This preserves the existing test/local override seam while making normal Scheduler delivery independent of user-device state. A legacy ACTIVE automation whose graph requires a capture input but lacks the new durable configuration fails `NOT_CONFIGURED` before browser allocation instead of executing with an unbound value.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** only explicitly acknowledged non-secret strings may use this storage path. Values are bounded to 64 required keys, 4,096 characters per value, and 32,768 characters total in core validation. Secrets remain outside normal automation records. Control-plane summaries do not return configured values.
- **Tenant isolation:** values are part of the existing tenant/user-scoped `AutomationRecord`; AWS persistence therefore uses the same scoped DynamoDB partition and ownership checks. The browser cannot submit tenant/user identity.
- **Idempotency/concurrency:** Scheduler occurrence identity and automation locking are unchanged. Duplicate deliveries read the same durable published configuration and still converge on one run. Publish validates inputs before Scheduler activation; the existing DynamoDB/Scheduler non-atomicity limitation remains unchanged.
- **Retry/timeout:** no new retry loop or timeout layer was added. A missing/invalid scheduled input is deterministic `NOT_CONFIGURED`, not transient retry material.
- **Side-effect verification:** unchanged. Inputs affect node execution only after the normal deterministic/reasoned action boundary and existing verification-before-success checks.
- **Cost:** no new AWS resource or read is required. The bounded input map rides on the AutomationRecord already loaded by scheduled preflight; cost is only a modest bounded increase in that existing DynamoDB item size.
- **Observability:** failure is represented by the existing sanitized `NOT_CONFIGURED` run failure code. Values are not added to logs, metrics, emails, or diagnostics.
- **User recovery:** newly published workflows cannot reach this failure because publish is gated. Legacy/malformed records fail before browser compute and can be corrected by republishing a tested workflow with explicit scheduled inputs.

### Validation added

- Core unit tests prove only unresolved compiler-generated capture keys are required, while preseeded capture values and arbitrary application bindings are ignored by this persistence boundary.
- Validation tests reject missing, extra, non-string, and oversized scheduled values.
- Local product lifecycle now proves a fresh test can use one per-run value while published scheduled execution later uses a different explicitly configured non-secret default without the scheduler payload supplying runtime variables.
- Publish tests prove missing acknowledgement, missing required values, and unrelated keys are rejected before Scheduler activation.
- Coordinator tests prove scheduled defaults reach READY and human-blocked checkpoints, explicit invocation values can override defaults, and legacy ACTIVE workflows with missing required configuration fail before a checkpoint/browser run is started.
- Web parsing tests prove acknowledged string-only JSON is accepted while malformed, non-string, and unacknowledged persisted values are rejected.
- Exact-head GitHub Actions must still prove strict TypeScript/Next.js builds, all production packaging/deployment contracts, and the full test suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish with schedule + any explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture in a separate tab -> start recording from the product tab -> compile/inspect -> supply Fresh Test runtime inputs -> fresh test -> publish with explicitly non-secret recurring values where needed -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. If the demo genuinely requires a recurring **secret** typed value outside target-site authentication, add a distinct vault-reference runtime-input contract. Never place the secret value itself in `scheduledNonSecretInputs`, workflow JSON, normal DynamoDB configuration, logs, or UI responses.
4. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
5. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- `scheduledNonSecretInputs` is intentionally plaintext ordinary configuration. It solves reusable non-secret captured typing only. Secret recurring values need a separate secret-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
