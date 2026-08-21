# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work remains parked.
- Versioned capture contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions; the local/mock lifecycle proves create -> capture -> compile -> test -> publish -> schedule -> execute -> history without secrets.
- Next.js + Cognito/API Gateway control plane provides dashboard/create/capture/compile/test/publish/history, BYOK credential settings, recurrence editing, pause/resume/disable, capture readiness, sanitized run diagnostics, and explicit HUMAN continuation.
- AWS production composition includes DynamoDB/S3 state, AgentCore Browser/Profile + Live View capture, long-running Runtime capture collection, AgentCore Identity BYOK, OpenAI reasoning, cloud fresh tests, SES notifications, CloudWatch telemetry, Scheduler/SQS/Step Functions dispatch, deterministic release packaging, ordered CloudFormation deployment, and GitHub OIDC deployment.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `1114e843c54da34ed75fcaed8676c198f1588329` (`Expose explicit HUMAN run continuation`) is green on GitHub Actions CI #194.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, packaging/release/deployment contract tests, Next.js build/type validation, and the full test suite succeed.

## 2026-08-21 — Target-auth browser takeover / repair UX

### Product slice

The remaining user-facing recovery gap for stale target-site authentication is now connected to the existing durable resume authority instead of creating another recovery engine.

A new provider-neutral `HumanTakeoverService` permits an action-capable repair browser only when the durable run is `WAITING_FOR_HUMAN`, the run/checkpoint identity matches, and the checkpoint's exact current node carries `TARGET_AUTH_REQUIRED`. Generic `POLICY_BLOCKED`, arbitrary `HUMAN_DECISION_REQUIRED`, quota/provider failures, and mismatched failure-node metadata cannot open this path.

Starting repair restores the automation's server-owned Browser Profile into an isolated browser session and returns only a bounded HTTPS Live View URL. The user completes login/MFA themselves. Browser Profile references and AgentCore browser-session IDs remain server-side. Duplicate starts reuse the existing live repair session; a concurrent losing allocation is stopped rather than becoming a second repair authority.

Finishing repair saves the Browser Profile before marking the takeover session completed, then best-effort closes ephemeral browser compute and submits the existing idempotent human-resume command for the exact paused node. Completion replay skips profile mutation and can retry the durable resume command. The resume worker now supports this one non-HUMAN shape: it re-executes the exact paused node only when its checkpoint proves `TARGET_AUTH_REQUIRED` for that same node. Existing explicit-HUMAN/single-successor behavior and first-successor effect reconciliation remain unchanged.

The AWS adapter persists one current takeover record per tenant/user/run with conditional DynamoDB writes and strongly consistent reads. AgentCore takeover sessions are bounded to 15 minutes by default, restore only the authorized Browser Profile, and use the existing region-validated Live View signer.

The authenticated Next.js run page now offers **Open secure repair browser** and **Save repaired session & resume** only for the sanitized target-auth attention shape. It explicitly tells users the platform does not solve or bypass CAPTCHA, MFA, or target-site security controls. Same-origin server routes invoke the authenticated control plane; no browser/profile/session identifiers are submitted by the browser.

### Security / tenancy / idempotency / concurrency / retry / timeout / verification / cost / observability

- Cognito/API Gateway tenant/user scope remains the sole control-plane authorization authority. Durable takeover records are tenant/user partitioned and embedded ownership is validated on read.
- The automation must still be `ACTIVE`, own the paused run, have an authorized Browser Profile, and match the exact paused checkpoint before browser allocation or profile save.
- Repair sessions are short-lived and server-owned. Live View URLs must be HTTPS without embedded credentials; only the URL and expiry are returned to the authenticated web tier.
- Conditional DynamoDB creation prevents two live repair sessions from becoming authoritative for one run. Exact completion is replayable; competing session identity conflicts.
- Profile persistence occurs before the takeover is durably completed and before resume is requested. A profile-save failure leaves the run paused and does not grant execution permission.
- Browser cleanup failure is non-authoritative and only produces a bounded cleanup warning; it cannot turn repair into success or replay workflow actions.
- Non-HUMAN resume is restricted to the exact `TARGET_AUTH_REQUIRED` node. Retry/fingerprint state is reset by the existing execution engine, while normal bounded retry, verification-before-success, profile-save-before-success, claim/lease/heartbeat fencing, and occurrence/run identity remain unchanged.
- The repair browser adds one bounded AgentCore Browser session only when the owner explicitly opens takeover. Duplicate start requests reuse an active session to avoid repeated compute allocation.
- Public diagnostics remain sanitized; raw provider/browser error strings, cookies, profile contents, BYOK keys, workload tokens, lease owner tokens, runtime variables, and model chain-of-thought remain excluded.

### Tests / validation

- Core tests cover successful target-auth repair, active-session reuse, save-before-resume ordering, generic-attention rejection, failure-node mismatch rejection, and cross-tenant suppression before browser allocation.
- Resume-worker regression coverage proves the exact paused non-HUMAN node can execute only after a matching `TARGET_AUTH_REQUIRED` checkpoint and rejects policy/mismatched-node pauses before browser startup.
- AWS tests cover conditional takeover persistence/contention, exact completion replay, Browser Profile restoration, and bounded Live View creation.
- Web-client coverage proves repair start/finish URLs are encoded and request bodies contain no browser/profile/session ownership identifiers.
- This section does not claim the new head green until GitHub Actions completes successfully on the exact published SHA.

## Next product milestones

1. Route post-human-resume terminal outcomes through the existing sanitized SES/CloudWatch reporting boundary without making notification delivery execution authority.
2. Run one controlled real AWS vertical demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore Browser/OpenAI execution -> verification/history/email, plus one deliberately expired target authentication -> browser takeover -> successful resume.
3. Fix only concrete defects exposed by that demo; do not return to narrow recovery micro-hardening unless required for correctness.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Post-human-resume terminal results update durable history but are not yet re-reported through SES/CloudWatch.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not live-cloud proof.
- CAPTCHA, MFA, security challenges, and target-site restrictions always remain human-operated/observed; the platform does not bypass them.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- DynamoDB automation status and EventBridge Scheduler state cannot be atomically committed; lifecycle ordering fails closed, with reconciliation deferred unless the live demo exposes practical drift.
- Capture-task duplicate suppression remains process-local while durable capture completion is global; add a durable collector claim only if Runtime replacement during the demo demonstrates the need.
- Release upload is not transactional across both S3 objects. Partial upload produces no deployment manifest/authority but can leave an orphan version for lifecycle cleanup.
