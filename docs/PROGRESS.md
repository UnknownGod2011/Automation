# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains in Git history; this checkpoint emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, explicit HUMAN continuation, target-auth browser takeover, and post-resume reporting. Narrower recovery work remains parked.
- Versioned capture contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions; the local/mock lifecycle proves create -> capture -> compile -> test -> publish -> schedule -> execute -> history without secrets.
- Next.js + Cognito/API Gateway control plane provides dashboard/create/capture/compile/test/publish/history, BYOK credential settings, recurrence editing, pause/resume/disable, capture readiness, sanitized run diagnostics, explicit HUMAN continuation, and secure target-auth repair UX.
- AWS production composition includes DynamoDB/S3 state, AgentCore Browser/Profile + Live View capture, long-running Runtime capture collection, AgentCore Identity BYOK, OpenAI reasoning, cloud fresh tests, SES notifications, CloudWatch telemetry, Scheduler/SQS/Step Functions dispatch, deterministic release packaging, ordered CloudFormation deployment, and GitHub OIDC deployment.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `679ddc3efa523993becf599a6a8e95524d9beb4b` (`Report human resume outcomes`) is green on GitHub Actions CI #196.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, packaging/release/deployment contract tests, Next.js build/type validation, and the full test suite succeed.

## 2026-08-21 — Deployment-to-web demo configuration boundary

### Product slice

The controlled AWS vertical demo had one practical configuration seam: the immutable backend deployment result exposed the control-plane URL and Cognito domain, but there was no deterministic command that turned those deployed outputs into the exact non-secret Next.js server environment while verifying that the deployed Cognito app client actually accepted that web origin.

`scripts/prepare-web-demo-env.sh` closes that seam. It consumes the deployment-result JSON plus the intended HTTPS web origin, reads the deployed Cognito app-client/user-pool outputs from CloudFormation, calls `cognito-idp describe-user-pool-client`, and fails closed unless authorization-code flow is enabled, the `openid email profile` scopes exist, and the exact callback/logout URLs match the requested origin. Only after those checks pass does it atomically write the web environment file.

The generated file contains only `AUTOMATION_CONTROL_PLANE_URL`, `AUTOMATION_COGNITO_DOMAIN`, `AWS_COGNITO_APP_CLIENT_ID`, and `AUTOMATION_WEB_ORIGIN`. It never accepts or writes AWS access keys, Cognito tokens, OpenAI/BYOK keys, workload tokens, Browser Profile references, browser-session IDs, or Live View credentials.

`docs/AWS_VERTICAL_DEMO.md` now defines the controlled success path and bounded target-auth recovery demonstration, the evidence that is safe to retain, and explicit stop conditions for ownership leaks, unverified side effects, duplicate actions, security-control bypass, unbounded retry, or secret-bearing diagnostics.

### Security / tenancy / idempotency / concurrency / retry / timeout / verification / cost / observability

- The helper uses the AWS CLI credential provider chain only; it adds no static credential input or secret persistence path.
- The requested web origin must be credential-free HTTPS with no path/query/fragment. Invalid origins fail before AWS calls.
- Cognito callback/logout compatibility is verified against the live deployed app-client configuration before the environment file is created, preventing a user-facing OAuth loop caused by stack/web-origin drift.
- The generated environment contains public deployment coordinates only. Request-scoped Cognito access/refresh tokens remain in the existing HttpOnly cookie/session boundary at runtime.
- This slice does not create cloud resources, browser/model calls, retries, schedules, or external side effects. Cost is limited to two CloudFormation output reads plus one Cognito app-client read when the operator prepares the web environment.
- The demo runbook explicitly requires one permitted test site/account and preserves the policy that CAPTCHA, MFA, target-site security controls, and anti-bot mechanisms are human-operated rather than bypassed.

### Tests / validation

- `scripts/test-prepare-web-demo-env.sh` uses a fake AWS CLI and proves correct environment rendering, correct CloudFormation/Cognito lookup scope, absence of credential-like fields, callback-origin mismatch failure with no output file, and insecure-origin rejection before additional AWS calls.
- CI now runs that test alongside the existing release/deployment/OIDC contract gates.
- Exact-head GitHub Actions after publication remains authoritative; this section does not claim the new head green before that run completes.

## Next product milestones

1. Use the immutable release/deployment path plus `prepare-web-demo-env.sh` to run one controlled real AWS vertical demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore Browser/OpenAI execution -> verification/history/email -> deliberately expired target authentication -> secure browser takeover -> successful resume -> post-resume email/CloudWatch outcome.
2. Fix only concrete defects exposed by that deployment/demo; do not return to narrow recovery micro-hardening unless required for correctness.
3. If the real demo proves repeatable, add only the minimum deployment smoke automation needed to make those real-cloud checks reproducible without storing long-lived credentials or GitHub Actions artifacts.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not live-cloud proof.
- The Next.js application still requires an external hosting/runtime choice for a durable public web origin; the new helper configures that origin safely but does not provision the hosting product.
- CAPTCHA, MFA, security challenges, and target-site restrictions always remain human-operated/observed; the platform does not bypass them.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- DynamoDB automation status and EventBridge Scheduler state cannot be atomically committed; lifecycle ordering fails closed, with reconciliation deferred unless the live demo exposes practical drift.
- Capture-task duplicate suppression remains process-local while durable capture completion is global; add a durable collector claim only if Runtime replacement during the demo demonstrates the need.
- Release upload is not transactional across both S3 objects. Partial upload produces no deployment manifest/authority but can leave an orphan version for lifecycle cleanup.
