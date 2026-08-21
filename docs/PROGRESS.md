# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. This file is intentionally consolidated around the current production state; detailed prior slice-by-slice history remains available in Git through the preceding validated heads.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> **inspect semantic plan** -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; known AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `177f9436cb7da0e93652b6c6c7a2a39a428ec35f` (`Expose fresh test correction feedback`) is green on GitHub Actions CI #205.
- GitHub Actions on the exact new head remains authoritative. This entry records intended validation for the current slice but does not claim a pass before that run exists.

## 2026-08-21 — sanitized compiled-workflow inspection

The end goal requires the user to **compile and inspect** the learned workflow before trusting a fresh cloud execution. The product previously compiled an immutable `WorkflowGraph` and immediately offered Fresh Test, but the control plane had no user-safe read surface for the graph. Returning the raw graph would be inappropriate because it can contain deterministic selectors, captured public literals in `initialVariables`, runtime-variable names, verification expected values, internal workflow/node identifiers, and retry internals.

This slice adds a provider-neutral `WorkflowInspectionService` plus `GET /v1/automations/:automationId/workflow`. It loads only the authenticated owner's immutable workflow versions, selects the latest compiled version, validates the graph, walks it deterministically from the entry node, and emits a bounded semantic inspection view. The view contains human-relevant step order, node kind/objective, declared side-effect class, verification mode, attempt/timeout bounds, escalation policy, and step-to-step control flow. It intentionally does **not** expose raw execution material.

The AWS control-plane bootstrap composes that read-only service against the existing `AwsWorkflowVersionRepository`; no new table, bucket, IAM action, Lambda, queue, Browser session, model invocation, or workflow execution path is introduced. The Next.js automation detail page now loads the view alongside its existing summary/run/capture reads and renders **Compile and inspect workflow** before Fresh Test.

### Security / tenancy / idempotency / concurrency / retry / timeout / side-effect verification / cost / observability / recovery

- Tenant/user scope comes only from the existing authenticated control-plane context. The service first confirms the automation exists in that ownership scope, then reads workflow versions using the same scope.
- The public view excludes `workflowId`, node IDs, deterministic strategy values (CSS/XPath/text/test-id/role selectors), input/output binding names, `initialVariables`, verification descriptions/expected values, retryable failure-code lists, Browser Profile references, provider secrets, workload tokens, and browser/session material.
- Step identifiers in the view are synthetic 1-based ordinals. Control-flow edges reference those ordinals rather than exposing durable node IDs; they carry no mutation or execution authority.
- The graph is revalidated with `assertWorkflowGraph` before projection. Cross-automation identity drift or malformed display metadata fails closed as `CONFLICT` rather than returning a partially trusted plan.
- The inspection is read-only and cannot create a run, acquire a lock, change a workflow version, dispatch Browser/model work, authorize a retry, publish, or resume a paused run.
- Existing side-effect verification remains authoritative. The UI reports only the verification **mode** and never turns a hidden verification expected value into editable client state.
- Response size is bounded to 200 displayed nodes while retaining `totalNodeCount` and a truncation signal. Execution continues to use the complete immutable graph.
- Cost is bounded to the existing workflow metadata query/S3 document reads when the automation detail page is opened. It adds no execution-plane compute and no new high-cardinality metric or durable record.
- User recovery is improved rather than widened: a user can see the semantic plan before paying for a fresh test, and can recapture immediately if the learned intent is visibly wrong. Failed fresh tests still use the existing diagnostics/correction/human-attention path.

### Validation added

- Core tests prove the newest immutable workflow is selected and transformed into ordered semantic steps.
- Redaction regression coverage places secrets/internal values in selectors, workflow/node IDs, initial variables, bindings, verification text/expected values, retry codes, and Browser Profile metadata, then proves none appear in serialized inspection output.
- Negative tests prove cross-tenant reads return `NOT_FOUND` and cross-automation/corrupted workflow identity fails closed.
- HTTP coverage proves only the authenticated GET inspection route is handled and unrelated routes are delegated unchanged.
- The Next.js production build remains the integration gate for the new inspection view and authenticated web-client request.
- Exact-head GitHub Actions after publication is authoritative.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The production AWS path is therefore intended to support: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture -> compile **and inspect the sanitized semantic plan** -> fresh test -> inspect/correct if needed -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. Fix concrete defects exposed by that live environment before adding more infrastructure or recovery depth.
4. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and the anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Workflow inspection is intentionally sanitized and bounded. It is a human intent-review surface, not a raw debugger; selector-level troubleshooting remains server-side/evidence-driven.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
