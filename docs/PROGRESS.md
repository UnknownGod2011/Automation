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
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `144e5c980d06303700e4ee5ed0e760533e8f3ec7` (`Keep schedule recurrence metadata consistent`) is green on GitHub Actions CI #215.
- CI #215 is the authoritative baseline: deterministic lock verification, frozen installation, strict checks/builds, production packaging/deployment contracts, and the full test suite succeeded.
- GitHub Actions on the exact new head remains authoritative. No pass is claimed for the current slice until that exact-head run completes successfully.

## 2026-08-22 — make privacy-preserving captured inputs usable in Fresh Test

The vertical-path audit found a real product gap between capture privacy and fresh-test usability. The production Playwright collector deliberately does not retain raw typed values. Every captured workflow `INPUT` becomes an unresolved synthetic runtime variable such as `capture_input_3`, which is the correct privacy boundary. The compiler then binds the generated TYPE step to that variable. However, the sanitized workflow inspection intentionally hid all binding names, while the Fresh Test UI accepted only a free-form runtime-variables JSON object. A user therefore had no way to know which safe synthetic key a privacy-preserving capture required, so a real capture containing typed workflow data could compile successfully but remain impractical to fresh-test.

The workflow inspection now exposes only unresolved capture-generated keys matching the closed `capture_input_N` namespace, together with the semantic step number. Arbitrary application/runtime binding names remain hidden. Inputs already supplied through immutable `initialVariables` are not surfaced. The response is bounded to 64 such requirements and treats every captured typed input as sensitive-by-default.

The Next.js semantic-plan card now tells the user exactly which synthetic runtime keys a Fresh Test requires and shows a JSON example without ever returning the captured value. It also makes the security boundary explicit: passwords, OTPs, API keys, and similar secrets must not be pasted into runtime JSON; target-site authentication belongs in the persisted Browser Profile. This slice does not pretend that per-run Fresh Test values are already a durable scheduled-input source.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- Tenant/user and automation ownership are unchanged and remain authenticated server-side. Workflow inspection still loads only the owner-scoped immutable workflow version.
- The only newly exposed identifiers are compiler-generated `capture_input_N` placeholders. They contain no captured value, selector, Browser Profile identifier, workflow/node identifier, provider secret, workload token, or arbitrary binding name.
- Arbitrary bindings such as `customer.email`, `api_token`, output bindings, initial-variable values, selectors, verification expected values/descriptions, and retry failure-code lists remain redacted.
- Runtime-input inspection is read-only and deterministic. It adds no mutation, retry loop, lease, queue, browser/model call, cloud resource, or recovery state.
- The requirements list is bounded, deduplicated, and ordered by semantic workflow traversal. Invalid/corrupt workflow state continues to fail closed.
- Side-effect verification, browser execution, retry/timeout semantics, BYOK handling, scheduling, and human recovery are unchanged.
- Cost is effectively unchanged: the data is derived from the same immutable workflow object already read for semantic inspection.
- The UI warning is explicit that Fresh Test runtime values are per-run material. A durable non-secret/default or secret-resolution source for scheduled runtime inputs remains a product capability to implement only when a real workflow needs it; do not persist secrets into ordinary workflow/checkpoint configuration merely to make scheduling convenient.

### Validation added

- Core workflow-inspection tests prove an unresolved `capture_input_7` is surfaced with its semantic step and sensitive-by-default marker.
- A capture-generated input already present in immutable `initialVariables` is not reported as unresolved.
- Arbitrary binding names (`customer.email`, `api_token`, internal output bindings) remain absent from serialized inspection output.
- Existing tenant isolation, corrupted-workflow, read-only route, selector/value/retry-code redaction tests remain in force.
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
- Captured typed workflow values are intentionally not persisted. Fresh tests can now discover their synthetic runtime keys, but scheduled runs still need an explicit durable input source when such values are required. Sensitive values need a secret-resolution contract rather than storage in normal tables/checkpoints.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
