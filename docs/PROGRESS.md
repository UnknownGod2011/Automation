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
- Next.js + Cognito/API Gateway control plane provides dashboard/create/capture/compile/test/publish/history, BYOK credential settings, recurrence editing, pause/resume/disable, and bounded capture-readiness polling.
- AWS production composition includes tenant-scoped DynamoDB/S3 state, AgentCore Browser/Profile + Live View capture, long-running Runtime capture collection, AgentCore Identity BYOK, OpenAI reasoning, cloud fresh tests, SES notifications, CloudWatch telemetry, and the trusted IAM-only capture-completion boundary.
- Scheduled execution is EventBridge Scheduler -> SQS -> dispatcher Lambda -> Step Functions Standard -> AgentCore Runtime with occurrence idempotency, automation locking, bounded retries, explicit verification, and DLQ/backpressure.
- Runtime and Lambda artifacts are deterministic Node 22 ZIP packages. `release-aws-artifacts.sh` uploads create-only objects to versioned S3 and records exact VersionIds; `deploy-aws-release.sh` deploys Cognito bootstrap -> Runtime -> scheduling -> control plane/capture -> Cognito route finalization -> optional observability.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `474740ef6abb4dec622a9ea1c1746c7a3eb262c2` is green on GitHub Actions CI #192.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, release/deployment contract tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — Sanitized run diagnostics

### Product slice

The control plane now has a provider-neutral read-only run-detail boundary over the existing run and checkpoint repositories. `GET /v1/automations/:automationId/runs/:runId` returns bounded diagnostic state: lifecycle timestamps/status, current node, failure code/retryability, completed-node progress, attempt count, repeated-state count, evidence references, and whether the run is waiting for human attention.

The view deliberately excludes checkpoint variables, raw failure messages, state fingerprints, Browser Profile/browser-session state, provider payloads, evidence contents, BYOK secrets, workload tokens, and model chain-of-thought. Durable run/checkpoint identity is revalidated before returning data; cross-tenant and cross-automation requests fail as `NOT_FOUND`, while corrupted run/checkpoint identity fails closed as `CONFLICT`.

AWS control-plane composition wraps the existing authenticated HTTP handler with this run-detail reader using the same DynamoDB run/checkpoint repositories already used by execution. No new database, artifact read, browser/model call, retry loop, or cloud service is introduced.

The Next.js automation history now links each run to a dedicated diagnostic page. A `WAITING_FOR_HUMAN` run is clearly presented as safely paused and requiring human attention; the page remains read-only and does not bypass the existing action-capable human-resume authority. This closes the observability/diagnosis half of the end-goal failure UX without reopening the already-deep recovery subsystem.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Tenant/user ownership comes only from the authenticated control-plane context; automation/run IDs are identifiers, not authorization authority.
- The run repository read is tenant scoped and the returned run must also belong to the requested automation. The checkpoint must match run ID, automation ID, and immutable workflow version.
- Failure messages and runtime variables are intentionally not part of the public type, preventing accidental rendering of provider errors or secret runtime inputs.
- Evidence references are metadata only, bounded in count/length, and are not dereferenced by this endpoint. Artifact access remains a separate protected concern.
- The endpoint is read-only and idempotent. Concurrent execution can produce a slightly newer run/checkpoint immediately after the read; identity validation prevents mixing data from another durable run/version, and no execution authority depends on this diagnostic snapshot.
- Cost is one scoped run read plus one scoped checkpoint read per detail request. The history endpoint remains summary-only, avoiding an N+1 checkpoint read for every automation-detail page load.
- No retry/timeout semantics or side-effect verification behavior changed. Human resume remains isolated from this surface.

### Tests / validation

- Core tests cover sanitization of variables/raw errors/fingerprints, tenant and automation isolation, durable checkpoint identity mismatch, bounded evidence metadata, route delegation, and cross-tenant `NOT_FOUND` behavior.
- Web-client coverage proves both automation and run identifiers are URL-encoded and the request-scoped Cognito bearer token remains server-side.
- The Next.js diagnostic page never requests evidence bodies or privileged recovery capabilities.
- This section does not claim the new head green until GitHub Actions completes successfully on the exact published SHA.

## 2026-08-21 — GitHub OIDC deployment workflow

### Product slice

A manual `.github/workflows/deploy-aws.yml` turns the existing immutable release + ordered deployment scripts into an operable production deployment path. The workflow accepts only a protected GitHub Environment name, runs only from `main`, validates deterministic dependencies and the complete source test suite, and requests AWS credentials only after validation succeeds.

AWS authentication uses GitHub OIDC through `aws-actions/configure-aws-credentials` with `id-token: write`, an environment-owned `AWS_DEPLOY_ROLE_ARN`, exact `AWS_ACCOUNT_ID` allow-listing, and an explicit STS identity check. The workflow has no static AWS-key inputs/secrets. Environment-specific CloudFormation parameters live in `AUTOMATION_AWS_ENVIRONMENT_JSON`; immutable artifact coordinates remain owned by `release-aws-artifacts.sh` and cannot be supplied through that JSON.

Each release identity binds the source SHA plus workflow run/attempt so a retried deployment never mutates an existing release object. The existing release script still requires S3 Versioning and create-only writes. Release/deployment manifests live only in `$RUNNER_TEMP`, are consumed inside the same job, and are never uploaded with `actions/upload-artifact`, avoiding GitHub Actions artifact-storage growth.

`docs/AWS_OIDC_DEPLOYMENT.md` documents protected-environment variables, exact-subject OIDC trust guidance, a non-secret environment JSON shape, and the residual orphaned-S3-version behavior after partial releases. A CI contract test protects the workflow against reintroducing static AWS credentials, Actions artifact uploads, deployment from non-main refs, pre-validation role assumption, or bypass of the deterministic release/deploy scripts.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- GitHub Environment approval/branch protection plus the IAM OIDC trust condition form the deployment authorization boundary. Production trust should match the exact repository/environment `sub`, never a broad repository wildcard.
- Tenant scope remains deployment-owned in the environment JSON and downstream CloudFormation; GitHub workflow inputs cannot inject tenant/user authority.
- The deploy job has one environment-scoped concurrency group with `cancel-in-progress: false`, preventing a newer manual click from canceling a deployment halfway through stack updates.
- Source validation happens before AWS role assumption, reducing credential lifetime and preventing known-red source from reaching CloudFormation through this workflow.
- The role session is bounded to one hour; the job has a 45-minute timeout. Runtime/browser/model execution permissions are not granted by the workflow itself; they remain on the deployed service roles.
- No new runtime package dependency, cloud resource, retry layer, browser/model invocation, or user-data store was added. GitHub artifact retention remains zero for this deployment path; durable release storage remains versioned S3 where lifecycle policy can manage old/orphaned versions.
- CloudFormation, S3 VersionIds, GitHub run identity, and the generated runner-local deployment result provide release correlation without logging credentials or BYOK material.

### Tests / validation

- `scripts/test-github-oidc-deploy-workflow.sh` verifies manual/environment-scoped deployment, `main` restriction, OIDC-only AWS auth, account allow-listing, deterministic install/check/test before role assumption, immutable release/deploy script usage, runner-local manifests, unique source-bound release identity, and absence of Actions artifact upload/static-key patterns.
- CI runs that deployment-workflow contract alongside existing package/release/deployment tests.

## Next product milestones

1. Add the action-capable human-attention UX only at the existing trusted resume boundary: a user should be able to inspect a `WAITING_FOR_HUMAN` run, enter/take over the authorized browser session when required, submit one idempotent resolution command, and observe the resulting run status. Do not redesign leases/reconciliation unless integration exposes a concrete defect.
2. Perform one controlled real AWS demonstration: sign in -> BYOK -> Live View capture -> compile -> fresh test -> approve/publish -> scheduled AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
3. Close only defects exposed by that vertical demo. Add collector replacement-worker recovery or richer capture failure status only if the live demo proves it necessary.
4. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- DynamoDB automation status and EventBridge Scheduler state cannot be atomically committed; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible if the live demo exposes it.
- Capture-task duplicate suppression is process-local while the durable completed-session boundary is global. Add a durable collector claim only if Runtime replacement during the controlled demo demonstrates the need.
- Background capture failure currently remains visible as durable WORKFLOW/finish state and bounded polling eventually stops; richer failure UI is deferred until live evidence requires it.
- Release upload is not transactional across both S3 objects. Partial upload produces no deployment manifest/authority but can leave an orphan object version for lifecycle cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and never becomes execution authority.
