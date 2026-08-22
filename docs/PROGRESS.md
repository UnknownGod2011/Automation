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
- Product-facing recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation, with recurrence kind and expression shape kept consistent.
- Workflow inspection exposes only unresolved compiler-generated `capture_input_N` keys, never captured typed values or arbitrary application binding names.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `0c141c4a078d28002adb8bc3ec8e4cf1aaeeefb7` (`Expose privacy-safe capture runtime inputs`) is green on GitHub Actions CI #216.
- CI #216 is the authoritative baseline: deterministic lock verification, frozen installation, strict checks/builds, production packaging/deployment contracts, and the full test suite succeeded.
- GitHub Actions on the exact new head remains authoritative. No pass is claimed for the current slice until that exact-head run completes successfully.

## 2026-08-22 — seed production scheduled checkpoints from compiled workflow inputs

A vertical-path audit found a concrete cloud-vs-local execution defect. `ScheduledRunCoordinator` created the initial variable checkpoint only in `FRESH_TEST` mode. The production `ScheduledRunWorker` uses this coordinator directly, so a normal scheduled run could enter `WorkflowExecutionEngine` with no checkpoint and therefore an empty variable map even when the immutable compiled graph carried `initialVariables`. Local/mock scheduled execution hid the defect because `AutomationProductLifecycleService.dispatchOccurrence()` manually created a checkpoint after coordinator preparation. A captured public literal could consequently work in Fresh Test and local scheduled tests but disappear in the real AWS scheduled path.

Initial checkpoint ownership now belongs to `ScheduledRunCoordinator` for every READY run. Before a scheduled or fresh-test run transitions from preflight into `RUNNING`, the coordinator persists the graph entry node together with the immutable graph `initialVariables` and any explicitly supplied invocation runtime variables. Human-blocked preflight checkpoints retain the same merged variables so target-auth repair or another bounded attention path does not lose the run's inputs.

The local product lifecycle now delegates scheduled checkpoint creation to the same coordinator and forwards its optional runtime variables into preparation rather than writing a second checkpoint afterward. Fresh tests that do not use this coordinator retain their existing dedicated seeding path.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- Tenant/user scope, immutable workflow version pinning, Browser Profile ownership, schedule occurrence idempotency, and automation locking are unchanged.
- This does not introduce a new secret store. Values accepted as per-run runtime variables were already persisted in fresh/local run checkpoints; the change makes the production scheduled path consistent with that existing execution contract. Raw provider keys, AgentCore workload tokens, cookies, and Browser Profile contents remain outside checkpoints.
- The immediate production benefit is immutable compiled `initialVariables`, including non-sensitive captured public literals. The scheduler still does not have a durable product source for unresolved dynamic `capture_input_N` values; this slice does not claim otherwise.
- The checkpoint is persisted after the automation lease is acquired and before the run becomes `RUNNING`, so the browser worker cannot start with an unseeded variable state. Duplicate schedule delivery still resolves through the existing durable occurrence key before browser execution.
- Blocked scheduled preflight now retains the same variable state instead of `{}`, improving deterministic target-auth/human recovery without changing the existing recovery authority.
- Retry budgets, timeouts, side-effect verification, reasoning constraints, and human-resume fencing are unchanged.
- Cost impact is one bounded initial DynamoDB checkpoint write per READY scheduled occurrence. That write is required durable execution state and occurs before expensive Browser/model startup.
- No new metric dimension, queue, AWS resource, dependency, IAM permission, or external API call was added.

### Validation added

- Coordinator tests prove a READY scheduled run checkpoints both graph `initialVariables` and invocation runtime variables before browser execution.
- A blocked scheduled run proves the same variables survive into the durable `WAITING_FOR_HUMAN` checkpoint.
- Existing local product-lifecycle coverage still proves scheduled TYPE execution receives both captured literals and per-run runtime values, now through the same coordinator-owned seeding path.
- Exact-head GitHub Actions must prove strict TypeScript/Next.js builds, packaging/deployment contracts, and the full suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture in a separate tab -> start recording from the product tab -> compile/inspect -> supply any explicitly non-secret Fresh Test runtime inputs -> fresh test -> inspect/correct if needed -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. If the demo workflow needs recurring dynamic typed values, add an explicit durable runtime-input configuration boundary before claiming those values are schedulable. Non-secret defaults and secret references must be distinct; raw secrets must remain outside normal DynamoDB/workflow/checkpoint configuration.
4. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
5. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Captured typed workflow values are intentionally not persisted. Fresh tests can discover their synthetic runtime keys, but scheduled runs still need an explicit durable input source when such values are required. Sensitive values need a secret-resolution contract rather than storage in normal tables/checkpoints.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
