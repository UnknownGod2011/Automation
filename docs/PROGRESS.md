# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Detailed historical slices remain available in Git; this file is consolidated around the current production state and the most recent product-facing changes.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `4543955c218d649fd8575607e070df9f8213d80d` (`Refresh publish-gate lock snapshot`) is green on GitHub Actions CI #210.
- CI #210 is the authoritative validation for the incoming state: deterministic lock verification, frozen installation, strict checks/builds, deployment/release contracts, and the full test suite succeeded.
- GitHub Actions on the exact new head remains authoritative. No pass is claimed for the current slice until that exact-head run completes successfully.

## 2026-08-22 — make active capture identity server-owned in the web product

The vertical-path audit found one remaining internal-identity seam in the authenticated capture UX. Start/Finish capture forms carried the opaque `captureSessionId` from rendered page state back to the Next.js mutation route. The provider-neutral control plane already revalidated that ID against the current tenant/user/automation session, so this was not an ownership bypass, but the browser did not need to choose the identifier at all.

The Next.js mutation route now reloads the current authenticated capture-recording state and resolves the active capture session server-side before issuing Start/Finish. Browser-submitted capture IDs are no longer execution authority. The rendered Start/Finish forms no longer contain the capture-session ID. Start remains replay-safe if the durable capture is already in `WORKFLOW`; it is suppressed after finish has been requested. Finish is rejected before `WORKFLOW` so authentication setup cannot accidentally be treated as the demonstrated workflow, while exact finish replay remains allowed.

### Security / tenancy / idempotency / concurrency / retry / verification / cost / observability / recovery

- Tenant/user ownership is still derived from the authenticated control-plane request and independently revalidated by the core capture service. The web server only narrows authority further by resolving the current session rather than trusting a form field.
- Browser/Profile/provider identifiers remain server-side. The opaque capture-session ID is no longer rendered in Start/Finish forms.
- Duplicate Start/Finish delivery keeps the existing durable idempotency semantics; no new capture task, retry loop, lease, recovery record, or browser/model execution path was introduced.
- The extra operation is one authenticated read of current capture state per Start/Finish mutation. This is control-plane-only cost and occurs only during interactive capture.
- Effect verification, trace persistence, Browser Profile save ordering, and capture-completion authority are unchanged.
- User recovery is unchanged: refresh the automation page if the active capture state has moved or expired.

### Validation added

- Web tests cover no-active-capture rejection, trusted AUTH_SETUP start, finish-before-WORKFLOW rejection, replay-safe Start/Finish behavior, finish-requested suppression of Start, and malformed server capture IDs.
- The mutation route consumes the helper and no longer reads `captureSessionId` from form data.
- The automation page removes the hidden capture-session fields from Start/Finish forms.
- Exact-head GitHub Actions after publication is authoritative.

## 2026-08-22 — require fresh-test provenance at the publish boundary

The vertical-path audit found that the server-owned publish-version resolver selected the highest successful workflow version from run history without checking the run's purpose. Normal lifecycle transitions usually hide this because `READY_TO_PUBLISH` follows a successful fresh test, but publication is a high-consequence boundary and must not rely on incidental state. A scheduled success or legacy/unclassified run should never be able to act as proof that a workflow version passed the required fresh-test gate.

`serverResolvedPublishWorkflowVersion` now accepts `runKind` as part of the durable summary evidence and considers only `SUCCEEDED + FRESH_TEST` runs. `SCHEDULED`, unclassified, failed, canceled, malformed, or otherwise non-qualifying runs are ignored. The existing lifecycle check that the requested version is the latest immutable workflow remains the final authority against stale or corrupt state.

### Security / tenancy / idempotency / concurrency / retry / verification / cost / observability / recovery

- The change is server-side only. Browser forms still cannot choose a workflow version, run kind, tenant, or user identity.
- No new persistence, cloud call, browser/model invocation, queue, retry loop, or recovery state is introduced.
- The gate is deliberately fail-closed: if durable run provenance is missing or legacy/unclassified, the web layer will not manufacture publish authority.
- Side-effect verification is unchanged; this strengthens only the evidence used to decide whether the user may activate a compiled workflow.
- Cost and concurrency impact are zero beyond the run-history data the page already loads.
- User recovery remains straightforward: run a successful fresh test for the current compiled version, then publish.

### Validation added

- Web tests prove the highest successful `FRESH_TEST` version is selected.
- A numerically higher successful `SCHEDULED` run cannot displace that fresh-test result.
- Successful runs with missing/unknown provenance do not authorize publication.
- `READY_TO_TEST` and failed fresh-test states still produce no publish candidate.
- CI #209 root cause was dependency-snapshot drift, not code/type/test behavior; the corrective commit updated only the reviewed lock fingerprint plus this progress record.
- CI #210 passed on the exact corrective head.

## 2026-08-22 — normalize product schedules before AWS publish

The real product page uses human schedule input while `AwsEventBridgeSchedulerAdapter` intentionally accepts EventBridge `rate(...)`/`cron(...)` expressions. The server-owned web mutation boundary now normalizes hourly, daily, weekly, and bounded custom-cron input before the Scheduler call. Malformed values fail before any schedule mutation, and existing normalized expressions remain editable.

The dashboard/detail schedule label also projects recognized AWS expressions back into readable recurrence text. No execution/retry/recovery semantics changed.

## 2026-08-21 — sanitized compiled-workflow inspection

The control plane now exposes a read-only latest-workflow inspection view before fresh testing. It shows ordered semantic steps, action kind/objective, side-effect declaration, verification mode, retry/timeout bounds, escalation policy, and control flow while excluding selectors, captured literals, runtime-variable names, verification expected values, retry codes, internal node/workflow IDs, Browser Profile references, secrets, and workload/browser credentials.

AWS production composition uses the existing immutable workflow repository, so inspection adds no execution-plane compute or new cloud resource. The response is bounded; execution continues to use the complete immutable graph.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> fresh test -> inspect/correct if needed -> publish using normalized recurrence/timezone -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. Fix concrete defects exposed by that live environment before adding more infrastructure or recovery depth.
4. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Workflow inspection is intentionally sanitized and bounded. Selector-level troubleshooting remains server-side/evidence-driven.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
