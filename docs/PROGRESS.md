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
- Incoming head `67c8a1aedcd8161ddbdc484c2c6cacf37113565a` (`Add durable scheduled capture inputs`) is green on GitHub Actions CI #219.
- Normal product commit `4d681e1667f59fd532349ab0bb635314acbbde91` (`Add semantic run diagnostics`) reached CI #220. Deterministic lock verification and `pnpm install --frozen-lockfile` passed. `pnpm check` then stopped on three test-only TS2783 duplicate-property diagnostics in the new `run-detail.test.ts` fixture helper (`id`, `kind`, `objective` were explicitly assigned and then repeated by a spread). Production code was not implicated; packaging and tests were correctly skipped after the strict type-check failure.
- The single corrective change replaces that fixture spread with an explicit typed test-node builder. No TypeScript rule, CI gate, runtime behavior, or security boundary is weakened.
- GitHub Actions on the exact outgoing corrective head remains authoritative. No pass is claimed until that exact-head run completes successfully.

## 2026-08-22 — semantic run diagnostics + server-owned resume boundary

The vertical-path audit found that the user-facing run page still rendered internal workflow node IDs and artifact-reference strings. That made a failed real run difficult to understand (`submit`, `node_7`, opaque evidence paths) and contradicted the product direction of keeping durable platform identities server-owned. The explicit HUMAN continuation form also sent the paused node ID back through a hidden browser form field even though the server can resolve that state itself.

`RunDetailService` now projects the immutable workflow into a bounded semantic run-progress view containing only step ordinal, node kind, and node objective for the current, completed, and failed steps. The projection deliberately excludes selectors, input/output bindings, captured/default values, verification expected values/descriptions, retry-code lists, workflow/node IDs, Browser Profile data, and provider/browser credentials. If workflow storage is temporarily unavailable or the immutable graph cannot be safely mapped, durable status/checkpoint diagnostics remain available while semantic display and HUMAN eligibility fail closed.

The Next.js run page uses this semantic projection instead of rendering internal node IDs. Evidence is shown only as a protected item count; raw artifact references and evidence contents are no longer rendered into the browser. This does not remove evidence authority from the execution/checkpoint records and does not change persistence or verification behavior.

Explicit HUMAN continuation is also more server-owned. The browser now submits only the run action. The authenticated Next.js server reloads the latest run detail, confirms `humanResumeEligible`, derives the paused node from matching run/checkpoint state, and only then sends the existing expected-node guard to the trusted control plane. Stale/mismatched state fails closed before resume submission. Runtime continues to revalidate the durable run, immutable workflow, claim, lease, and node boundary before browser/model execution.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** rendered diagnostics no longer disclose internal node IDs or artifact-reference strings. Semantic projection is a closed display schema of ordinal/kind/objective only. Resume-node identity is no longer browser-selected.
- **Tenant isolation:** `RunDetailService` still loads the run/checkpoint/workflow through the authenticated tenant/user scope and rejects cross-automation access before semantic projection.
- **Idempotency/concurrency:** human-resolution claim/lease behavior is unchanged. The web route reloads current durable state immediately before the idempotent resolution command, reducing stale-page ambiguity without adding a second authority.
- **Retry/timeout:** no new retry loop, timeout, browser call, model call, or queue is introduced. Workflow-store display failure is non-authoritative and does not retry execution.
- **Side-effect verification:** unchanged. The semantic view is read-only and cannot authorize or execute a workflow action.
- **Cost:** one immutable workflow read already existed in production run detail for HUMAN eligibility. Semantic projection reuses that read; there is no new AWS resource or N+1 history cost.
- **Observability:** execution/checkpoint evidence remains durable. The UI exposes counts and semantic location rather than opaque storage keys; raw errors and evidence content remain excluded.
- **User recovery:** a paused user now sees an understandable semantic step/objective. Explicit HUMAN continuation still uses the existing durable claim/lease/heartbeat/reconciliation machinery, while target-auth repair remains the separate bounded Live View path.

### Validation added

- Core tests prove semantic current/completed/failure mapping and prove selectors, arbitrary binding names, initial values, verification expectations, raw failure text, variables, and fingerprints do not enter the semantic diagnostic response.
- Core tests prove workflow-store failure preserves run/checkpoint diagnostics while omitting semantic display and HUMAN eligibility.
- Existing tenant/automation isolation, checkpoint-identity, malformed evidence, and authenticated HTTP routing tests remain.
- Web tests prove the resume node is resolved from matching authenticated run/checkpoint state and fails closed for mismatched or ineligible state.
- Next.js rendering no longer displays raw node IDs or artifact references and its HUMAN form carries no expected-node hidden field.
- Exact-head GitHub Actions must still prove strict TypeScript/Next.js builds, all production packaging/deployment contracts, and the full test suite.

## 2026-08-22 — durable non-secret scheduled inputs for captured typing

Production capture intentionally never persists raw typed values and emits unresolved `capture_input_N` bindings instead. Fresh Test can supply those values per run, but recurring execution previously had no durable value source. Publishing now requires explicit bounded non-secret defaults for every unresolved compiler-generated capture input that a scheduled workflow needs.

`scheduledNonSecretInputs` remain tenant/user-owned ordinary automation configuration and are omitted from sanitized summaries. The product requires explicit acknowledgement that these values are safe to persist and warns against passwords, OTPs, API keys, tokens, or other secrets. Scheduled preflight validates the required set before browser/model allocation and seeds variables in this precedence order: immutable graph `initialVariables` -> persisted scheduled non-secret inputs -> explicit invocation overrides. Legacy ACTIVE records missing required inputs fail `NOT_CONFIGURED` before browser compute.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish with schedule + any explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture in a separate tab -> start recording from the product tab -> compile/inspect -> supply Fresh Test runtime inputs -> fresh test -> publish with explicitly non-secret recurring values where needed -> scheduled execution -> semantic run diagnostics/history/email -> target-auth takeover/resume.
3. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
4. If the demo genuinely requires a recurring **secret** typed value outside target-site authentication, add a distinct vault-reference runtime-input contract. Never place the secret value itself in `scheduledNonSecretInputs`, workflow JSON, normal DynamoDB configuration, logs, or UI responses.
5. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- `scheduledNonSecretInputs` is intentionally plaintext ordinary configuration. It solves reusable non-secret captured typing only. Secret recurring values need a separate secret-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
