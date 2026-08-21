# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Detailed historical slices remain available in Git; this file is intentionally consolidated around the current production state and latest product-facing work.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

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
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `e08eed9986c72de3faf85d2e9737f8785fb409aa` (`Refresh Live View handoff lock snapshot`) is green on GitHub Actions CI #214.
- CI #214 is the authoritative baseline: deterministic lock verification, frozen installation, strict checks/builds, production packaging/deployment contracts, and the full test suite succeeded.
- GitHub Actions on the exact new head remains authoritative. No pass is claimed for the current slice until that exact-head run completes successfully.

## 2026-08-22 — keep recurrence kind and provider expression consistent

The vertical-path audit found a scheduling correctness hole at the web mutation boundary. Product recurrence metadata (`DAILY` / `WEEKLY`) and the normalized EventBridge expression were parsed separately. The parser previously accepted **any** existing `cron(...)` expression for either a daily or weekly form submission. A stale management form could therefore be changed from one recurrence kind to another without changing its expression and create contradictory durable state such as `kind = WEEKLY` with a daily cron.

The product boundary now accepts an already-normalized cron for `DAILY` only when it has the canonical daily shape, and for `WEEKLY` only when it has the canonical weekly weekday shape. Human-friendly `HH:MM` and `DAY HH:MM` inputs still normalize exactly as before. Custom cron remains the explicit escape hatch for advanced cron syntax.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- This is a server-side form-validation change only; authenticated tenant/user ownership, automation lifecycle state, and Scheduler IAM boundaries are unchanged.
- Invalid or internally inconsistent recurrence submissions now fail closed before EventBridge Scheduler mutation, reducing the chance that user-facing recurrence metadata diverges from actual cloud delivery semantics.
- Existing exact resubmission of a valid normalized daily/weekly expression remains idempotent.
- No new retry loop, concurrency primitive, browser/model execution, queue, database, cloud resource, or recovery state was introduced.
- Cost is unchanged because rejected inconsistent submissions stop before a Scheduler API call.
- Observability remains the existing sanitized `invalid-input` UX; provider internals are not surfaced.
- Human recovery semantics are unrelated and remain parked.

### Validation added

- Web schedule tests prove a weekly cron cannot be accepted under `DAILY`.
- Web schedule tests prove a daily cron cannot be accepted under `WEEKLY`.
- Existing tests continue covering default daily normalization, weekly local-time normalization, custom cron, bounded form input, and user-facing labels.
- Exact-head GitHub Actions must prove strict TypeScript/Next.js builds, packaging/deployment contracts, and the full suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture in a separate tab -> start recording from the product tab -> compile/inspect -> fresh test -> inspect/correct if needed -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. Fix concrete defects exposed by that live environment before adding more infrastructure or recovery depth.
4. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
