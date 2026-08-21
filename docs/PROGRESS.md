# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, atomic already-applied recovery primitives, explicit HUMAN continuation, and target-auth browser takeover. Narrower recovery work remains parked.
- Versioned capture contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions; the local/mock lifecycle proves create -> capture -> compile -> test -> publish -> schedule -> execute -> history without secrets.
- Next.js + Cognito/API Gateway control plane provides dashboard/create/capture/compile/test/publish/history, BYOK credential settings, recurrence editing, pause/resume/disable, capture readiness, sanitized run diagnostics, explicit HUMAN continuation, and secure target-auth repair UX.
- AWS production composition includes DynamoDB/S3 state, AgentCore Browser/Profile + Live View capture, long-running Runtime capture collection, AgentCore Identity BYOK, OpenAI reasoning, cloud fresh tests, SES notifications, CloudWatch telemetry, Scheduler/SQS/Step Functions dispatch, deterministic release packaging, ordered CloudFormation deployment, and GitHub OIDC deployment.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `b658638acb2c37df00c24c9545a902480a0081dc` (`Add target-auth browser takeover`) is green on GitHub Actions CI #195.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, packaging/release/deployment contract tests, Next.js build/type validation, and the full test suite succeed.

## 2026-08-21 — Post-human-resume outcome reporting

### Product slice

Human resume now rejoins the same sanitized SES/CloudWatch product-reporting boundary used by scheduled execution. A newly executed resume that reaches `SUCCEEDED`, `FAILED`, `WAITING_FOR_HUMAN`, `CANCELED`, or `SKIPPED` can emit a terminal outcome after durable execution has already decided the run state.

The reporting path deliberately does not become execution authority. Human-resolution claim replay/conflict and lease-busy outcomes never invoke terminal reporting, so at-least-once delivery of the same resolution cannot intentionally send another completion email. Telemetry/notification failures are reduced to fixed warnings and cannot change the durable resume result or trigger browser/model replay.

The shared reporter now emits `human_resume_outcome` events for resume completions while preserving the existing notification preferences and failure-code sanitization. CloudWatch EMF records resume outcomes under `HumanResumeCount`, separate from `ScheduledRunCount`, so repair/resume activity does not inflate scheduled-occurrence metrics or alarms. Tenant/user/automation/run identifiers remain searchable correlation fields rather than custom-metric dimensions.

The production AWS bootstrap injects the same reporting composition into both scheduled and human-resume handlers. The resume handler loads the authorized automation before execution when reporting is configured, and only reports after an `EXECUTED` orchestration result. Duplicate, conflicting, busy, and not-waiting submissions remain non-reporting.

### Security / tenancy / idempotency / concurrency / retry / timeout / verification / cost / observability

- Reporting reuses the trusted Runtime tenant/user scope and the server-loaded automation. It does not accept a recipient address, Browser Profile reference, session identifier, BYOK secret reference, workload token, or lease owner token from the resume payload.
- User-facing email and telemetry include stable run identity, status, bounded node/failure codes, and timing only. Raw provider/browser errors, evidence contents, runtime variables, cookies, credentials, and model chain-of-thought remain excluded.
- Reporting happens strictly after durable human-resume execution authority has completed. SES/CloudWatch failures cannot reinterpret run success/failure, reacquire a lease, or repeat a website action.
- Exact duplicate resolution delivery remains suppressed by the existing claim boundary and therefore does not produce duplicate resume-terminal reporting.
- Resume metrics use the existing EMF log path and low-cardinality `Service` + `Outcome` dimensions. This adds no CloudWatch SDK request per run and does not increase scheduled-run metric counts.
- No dependency, DynamoDB table, S3 object, browser session, model call, retry loop, or cloud resource is added by this slice.

### Tests / validation

- Core reporting tests cover human-resume success notification/telemetry and suppression of non-terminal resume reporting while preserving existing scheduled-run redaction and duplicate-delivery behavior.
- AWS telemetry tests prove `human_resume_outcome` emits `HumanResumeCount` and does not emit `ScheduledRunCount` while retaining the existing low-cardinality metric dimensions.
- The AWS production bootstrap is wired to the same reporter for human resume. Exact-head GitHub Actions remains the authoritative integration validation after publication.

## Next product milestones

1. Run one controlled real AWS vertical demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore Browser/OpenAI execution -> verification/history/email, plus one deliberately expired target authentication -> secure browser takeover -> successful resume -> post-resume email/CloudWatch outcome.
2. Fix only concrete defects exposed by that deployment/demo; do not return to narrow recovery micro-hardening unless required for correctness.
3. Add deployment/demo operator notes or smoke automation only where the real environment shows they are necessary for repeatability.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not live-cloud proof.
- CAPTCHA, MFA, security challenges, and target-site restrictions always remain human-operated/observed; the platform does not bypass them.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- DynamoDB automation status and EventBridge Scheduler state cannot be atomically committed; lifecycle ordering fails closed, with reconciliation deferred unless the live demo exposes practical drift.
- Capture-task duplicate suppression remains process-local while durable capture completion is global; add a durable collector claim only if Runtime replacement during the demo demonstrates the need.
- Release upload is not transactional across both S3 objects. Partial upload produces no deployment manifest/authority but can leave an orphan version for lifecycle cleanup.
