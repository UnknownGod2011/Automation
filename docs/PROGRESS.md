# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work remains parked.
- Versioned capture contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions; the local/mock product lifecycle proves create -> capture -> compile -> test -> publish -> schedule -> execute -> history without cloud credentials.
- Next.js + Cognito/API Gateway control plane provides dashboard/create/capture/compile/test/publish/history, BYOK credential settings, recurrence editing, pause/resume/disable, bounded capture-readiness polling, and sanitized per-run diagnostics.
- AWS production composition includes tenant-scoped DynamoDB/S3 state, AgentCore Browser/Profile + Live View capture, long-running Runtime capture collection, AgentCore Identity BYOK, OpenAI reasoning, cloud fresh tests, SES notifications, CloudWatch telemetry, and the trusted IAM-only capture-completion boundary.
- Scheduled execution is EventBridge Scheduler -> SQS -> dispatcher Lambda -> Step Functions Standard -> AgentCore Runtime with occurrence idempotency, automation locking, bounded retries, explicit verification, and DLQ/backpressure.
- Runtime and Lambda artifacts are deterministic Node 22 ZIP packages. `release-aws-artifacts.sh` uploads create-only objects to versioned S3 and records exact VersionIds; `deploy-aws-release.sh` deploys Cognito bootstrap -> Runtime -> scheduling -> control plane/capture -> Cognito route finalization -> optional observability.
- GitHub deployment uses protected environments + OIDC short-lived AWS credentials after source validation and retains no GitHub Actions ZIP artifacts.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `bb4023009c19430dea974addc0677ad316c7d8a1` (`Add sanitized run diagnostics`) is green on GitHub Actions CI #193.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — Explicit HUMAN-node continuation UX

### Product slice

The read-only run diagnostics now connect to the existing trusted human-resume machinery for the workflow shape the engine already supports safely: an explicit `HUMAN` node with exactly one immutable successor.

`RunDetailService` exposes a read-only `humanResumeEligible` hint only when the durable run is `WAITING_FOR_HUMAN`, the run/checkpoint node identity agrees, the immutable workflow version can be loaded, and the current node is `HUMAN` with one existing successor. Workflow-store failure suppresses the action hint but does not make diagnostics unavailable. The hint is not execution authority; AgentCore Runtime and `HumanResumeWorker` revalidate the run, checkpoint, workflow version, active automation, explicit HUMAN node, and successor again before browser/model work.

A new provider-neutral `HumanResumeControlPlaneService` + HTTP wrapper adds `POST /v1/automations/:automationId/runs/:runId/resume`. Authenticated tenant/user scope is the only ownership authority. The browser supplies only the expected paused node; the control plane derives the stable resolution ID `authenticated-user-confirm-v1` server-side so a form submission cannot select or race a competing durable claim identity.

Production AWS composition routes the command through the existing configured AgentCore Runtime rather than executing browser/model work inside the API Lambda. `AwsAgentCoreHumanResumeExecutionPort` places user identity in AgentCore's trusted Runtime user field and sends only bounded run/automation/node/resolution metadata in JSON. The workload access token remains Runtime-injected capability material and never enters the control-plane request body.

Inside Runtime, `AwsHumanResumeRunHandler` reuses the already-built `HumanResolutionCoordinator`, durable DynamoDB resolution claim, execution lease, heartbeat-fenced `HumanResumeWorker`, effect reconciliation store, redacted audit store, AgentCore Browser/Profile session manager, Playwright runtime, AgentCore Identity BYOK vault, and OpenAI provider routing. No second resume engine or new recovery state machine was introduced.

The Next.js run-detail page now shows **Continue workflow** only for this explicit safe shape. Same-origin server routing preserves the Cognito session boundary. Ordinary failed-node pauses such as `TARGET_AUTH_REQUIRED`, MFA/authentication repair, or other non-HUMAN recovery do **not** get this button; the page says browser takeover remains a separate protected path.

### Security / tenancy / idempotency / concurrency / retry / timeout / side-effect verification / cost / observability

- Tenant/user scope comes from Cognito/API Gateway in the control plane and AgentCore Runtime user identity in the execution plane; request JSON cannot override either.
- Run must belong to the requested automation, checkpoint identity must match run/automation/workflow version, and expected node must match the durable checkpoint before Runtime invocation.
- Resolution identity is server-owned and stable for this single-successor confirmation UX. Duplicate submissions therefore converge on the same existing durable run/node claim instead of creating another action authority.
- If the run already left `WAITING_FOR_HUMAN`, the control plane returns a non-executing `NOT_WAITING` result. If concurrent submissions reach Runtime while still paused, the existing claim/lease semantics return duplicate/busy/conflict without granting a second executor.
- Runtime JSON contains no tenant authority, BYOK secret, workload token, Browser Profile ref, lease owner token, cookies, browser state, or provider error body.
- The existing heartbeat, verification-before-success, profile-save-before-success, bounded retry, and effect-reconciliation behavior remains unchanged. The UI cannot choose a branch; explicit HUMAN continuation still requires exactly one declared successor.
- Run-detail cost adds an immutable workflow lookup only for a human-waiting run when a workflow repository is configured. A resume click adds one AgentCore Runtime invocation; accepted execution then pays the existing Browser/model cost. Duplicate/stale commands are fenced before a second external action authority is granted.
- Existing redacted human-resume audit events remain enabled in the AWS bootstrap. The public response returns only bounded outcome kind, run ID, and run status.
- Resumed-run success/failure is visible through the existing durable run/checkpoint history. The scheduled outcome reporter is not yet re-fired specifically for a post-human-resume completion, so a second completion email after resume remains a product follow-up rather than an execution-authority requirement.

### Tests / validation

- Core tests cover authenticated ownership, cross-automation isolation, stale-node rejection, server-owned resolution identity, non-execution after the run leaves the wait state, explicit-HUMAN/single-successor eligibility, and diagnostic availability during workflow-store outage.
- AWS tests cover control-plane-to-Runtime payload minimization, cross-tenant rejection before Runtime invocation, and AgentCore Runtime routing of `HUMAN_RESUME` through trusted scope rather than the scheduled handler.
- Web-client coverage verifies URL encoding, authenticated request routing, and that the browser submits only the expected node rather than ownership/claim credentials.
- This section does not claim the new head green until GitHub Actions completes successfully on the exact published SHA.

## Next product milestones

1. Add the missing **browser takeover/repair session UX** for non-HUMAN attention states such as target authentication: create a server-owned AgentCore Browser session from the automation profile, expose bounded Live View to the authenticated owner, durably save the repaired profile, and then submit the existing idempotent resume authority. Do not redesign claims/leases/reconciliation.
2. Ensure post-resume terminal outcomes reuse the existing sanitized SES/CloudWatch reporting boundary without making notification delivery execution authority.
3. Perform one controlled real AWS demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
4. Close only defects exposed by that vertical demo. Add collector replacement-worker recovery or richer capture failure status only if live evidence proves it necessary.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Browser takeover for authentication/MFA/ordinary failed-node repair is not yet exposed; this slice intentionally supports only the already-safe explicit `HUMAN` single-successor path.
- A post-human-resume terminal result updates durable history but does not yet emit a second scheduled-outcome notification/telemetry report.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- DynamoDB automation status and EventBridge Scheduler state cannot be atomically committed; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible if the live demo exposes it.
- Capture-task duplicate suppression is process-local while the durable completed-session boundary is global. Add a durable collector claim only if Runtime replacement during the controlled demo demonstrates the need.
- Background capture failure currently remains visible as durable WORKFLOW/finish state and bounded polling eventually stops; richer failure UI is deferred until live evidence requires it.
- Release upload is not transactional across both S3 objects. Partial upload produces no deployment manifest/authority but can leave an orphan object version for lifecycle cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and never becomes execution authority.
