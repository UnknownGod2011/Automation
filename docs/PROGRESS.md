# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries. Historical milestone detail remains available in Git history; this checkpoint intentionally emphasizes current production state, validation, active risks, and the next outward product work.

## Product/lifecycle target

sign in -> dashboard -> create automation -> website/objective/consent -> cloud capture -> persisted Browser Profile + trace -> compile semantic `WorkflowGraph` -> fresh cloud test -> approve/correct -> recurrence/timezone -> publish -> scheduled cloud run -> reasoning + deterministic browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed production foundation

- Strict TypeScript/pnpm monorepo with pinned Node/pnpm, deterministic reviewed lock materialization, frozen installs, and the AWS SDK peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and deterministic in-memory adapters.
- Deep execution/human-recovery substrate already exists: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts plus `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, verification for side effects, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves the local/mock create -> capture -> compile -> fresh test -> publish -> schedule -> execute -> history lifecycle without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus the Next.js app provide dashboard/create/capture/compile/test/publish/history, authenticated credential settings, and published schedule update/pause/resume/disable controls.
- Cognito managed login uses authorization-code + PKCE; API Gateway-verified access-token claims become the trusted user boundary while tenant identity remains deployment-owned.
- AgentCore Live View capture restores a server-owned Browser Profile. Durable capture completion saves profile state before accepting immutable captured trace data. Capture trace metadata is tenant-scoped in DynamoDB while full validated traces and workflow versions are immutable S3 documents.
- AgentCore Identity-backed BYOK keeps plaintext provider keys out of ordinary tables. The credential pool is deterministic, tenant-scoped, sanitized, and wired to real OpenAI Responses API reasoning through runtime-only secret retrieval.
- Production fresh tests use AgentCore Runtime and the same hardened browser/BYOK execution plane as scheduled runs; configured cloud deployments cannot silently fall back to browser/model execution in API Lambda.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard -> AgentCore Runtime provides buffered at-least-once scheduling with occurrence-derived durable idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- Scheduled execution composes DynamoDB run/checkpoint/lock state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, SES notifications, CloudWatch EMF telemetry, and trusted Cognito email lookup.
- AgentCore Runtime and the control-plane Lambda are deterministic Node 22 ZIP packages with deployment templates and bounded IAM roles.
- `createAwsControlPlaneBootstrap` composes the production control-plane graph from DynamoDB/S3 persistence, AgentCore Browser/Profile capture, AgentCore Identity credential management, AgentCore Runtime fresh testing, EventBridge Scheduler, Cognito-authenticated HTTP transport, and a separate trusted capture-completion handler.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `238b9bab3581dedef80921c24d33805661e1c728` is green on GitHub Actions CI #180.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — deterministic AWS release artifact boundary

### Product slice

Added `scripts/release-aws-artifacts.sh` as the deployment/release boundary for the already-tested AgentCore Runtime and control-plane Lambda ZIPs. The command either packages both artifacts using the existing deterministic package scripts or accepts explicit prebuilt ZIPs, validates their required entrypoints, and uploads them under one unique release ID.

The release bucket must already have S3 Versioning in `Enabled` state. Each artifact upload is create-only (`If-None-Match: *`) and the command refuses to publish a release manifest unless S3 returns a non-null object `VersionId` for both ZIPs. This makes the emitted deployment inputs immutable instead of relying on the latest object at a mutable key.

After both uploads succeed, the command writes a local JSON manifest containing only release metadata, SHA-256 digests, exact S3 keys/VersionIds, and the CloudFormation parameters required by `infra/aws/agentcore-runtime.yaml` and `infra/aws/control-plane-service.yaml`. The manifest contains no AWS credentials or secret application configuration. The command never accepts credentials as arguments; AWS authentication remains the AWS CLI credential-provider-chain responsibility, allowing deployments to use short-lived OIDC credentials rather than repository secrets.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Release artifacts are code packages, not tenant data. Runtime tenant IDs, Cognito configuration, BYOK secrets, Browser Profiles, and provider credentials remain CloudFormation/runtime configuration and are not embedded into the release manifest.
- Upload keys are release-ID scoped and create-only. Reusing a release ID fails instead of silently replacing a deployment artifact.
- S3 Versioning is a hard prerequisite; a suspended/unversioned bucket fails before packaging upload authority is used. The command also requires the actual returned `VersionId`, so a null version cannot be mistaken for an immutable release.
- The two S3 writes cannot be atomic. If the second upload fails, the first object version may remain orphaned, but no manifest is produced and no deployment is authorized from the partial release. Operators can retry with a new release ID or explicitly clean the orphan.
- No application retry loop is added around uncertain S3 writes. AWS CLI/network uncertainty fails visibly rather than guessing success. A future release inventory/garbage-collection task may clean orphaned code versions by retention policy.
- Encryption is explicit: AES-256 by default or a caller-supplied KMS key. Bucket policy can further require a customer-managed key in production.
- CI validates the release contract with a fake AWS CLI and synthetic valid ZIPs, including positive immutable-version manifest generation and rejection of a non-versioned bucket. CI does not contact AWS, retain artifacts, or require cloud credentials.
- Cost impact is limited to two versioned S3 object writes/storage per successful release plus normal deployment reads. Unique release objects make rollback/audit straightforward at the cost of retaining old code versions until lifecycle cleanup.

### Tests / validation

`.github/workflows/ci.yml` now executes `scripts/test-release-aws-artifacts.sh` after both production packaging smoke tests. The shell regression test verifies exact VersionId propagation into both CloudFormation parameter sets, create-only upload semantics, encryption flags, checksum metadata, and fail-closed bucket-versioning behavior.

This implementation, tests, CI wiring, and progress checkpoint are published as one coherent multi-file Git-data commit. No package manifest or pnpm dependency graph changed. Exact-head GitHub Actions remains authoritative; this section does not claim the new head green until CI completes successfully.

## Next product milestones

1. Close the trusted capture-completion deployment route: provision a deployment-authenticated worker/API boundary that can invoke the already-separated completion handler without exposing it through the ordinary Cognito end-user route.
2. Add a deployment wrapper that consumes the release manifest plus stack-specific non-secret/secret parameters and performs ordered CloudFormation deployment while preserving short-lived AWS credential handling; do not move environment secrets into the release manifest.
3. If real fresh tests commonly exceed the API Gateway request window, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- Trusted capture-completion worker authentication is not yet provisioned as a deployment resource.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
