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
- The control-plane artifact now also packages a separate capture-completion Lambda entrypoint behind a dedicated IAM-authenticated HTTP API route; the ordinary Cognito API never exposes that privileged completion path.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `0e59fad16e1706f5eac04c65a223ba135436c736` is green on GitHub Actions CI #181.
- GitHub Actions on the exact head created by each run remains authoritative. Never claim a new slice green until deterministic lock verification, frozen install, `pnpm check`, deployment-package smoke tests, Next.js build/type validation, and the complete test suite succeed.

## 2026-08-21 — trusted capture-completion deployment boundary

### Product slice

The already-separated `TrustedCaptureCompletionHandler` now has a concrete production transport and deployment boundary. `createAwsCaptureCompletionLambdaHandler` accepts only API Gateway HTTP API payload-format 2.0 `POST /capture/complete` requests, bounds the JSON body, pins tenant identity to deployment-owned `AUTOMATION_TENANT_ID`, derives user scope from the captured trace, and invokes the existing trusted completion handler. Unexpected transport failures are converted to fixed sanitized errors.

`createAwsCaptureCompletionRuntimeEntrypoint` lazily reuses the production control-plane bootstrap only to obtain its already-separated capture-completion handler. The Lambda package now includes `capture-completion-lambda.mjs` alongside the ordinary control-plane entrypoint. The release command treats both entrypoints as required members of the same immutable/versioned control-plane artifact, so a supplied prebuilt ZIP cannot silently omit the privileged completion runtime.

`infra/aws/control-plane-service.yaml` now provisions a second Lambda function with a capture-only execution role and a separate API Gateway HTTP API containing exactly one route: `POST /capture/complete` with `AuthorizationType: AWS_IAM`. API Gateway therefore requires SigV4 plus `execute-api:Invoke` before invoking the Lambda. The template outputs the exact route ARN that a deployment must grant only to its trusted capture worker. This route is not added to the Cognito/JWT end-user API.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability review

- Authentication authority is deployment IAM, not request JSON. The worker request cannot set `trustedCaptureWorker`; the Lambda adapter supplies that capability only after the IAM-authenticated route has been reached.
- Tenant scope is independently pinned to `AUTOMATION_TENANT_ID`; a cross-tenant trace is rejected before profile save, trace persistence, or completion-state mutation. The existing capture-session record then revalidates user, automation, Browser Profile, and trace identity before completion.
- The Lambda resource policy permits invocation only from the dedicated API Gateway route. A worker receives only `execute-api:Invoke` on the emitted route ARN; it does not need direct Lambda invoke permission.
- The dedicated Lambda role omits scheduler control, BYOK credential-provider mutation/retrieval, AgentCore Runtime invocation, Live View connection, SES, and browser-session creation. It retains only capture DynamoDB/S3/KMS operations, Browser Profile read, capture-session save/stop operations, and logs.
- The existing completion ordering remains authoritative: save Browser Profile -> persist immutable trace -> atomically mark session complete/latest -> stop ephemeral browser. Exact same-trace delivery remains replay-safe; different trace content remains a conflict.
- API Gateway throttles the privileged endpoint and Lambda reserved concurrency provides an additional cost/concurrency bound. No new application retry loop exists; IAM/API/Lambda or storage uncertainty remains visible to the trusted worker and is safe to redeliver under the existing exact-trace idempotency behavior.
- Logs and responses remain sanitized. The route carries trace metadata/artifact references but must not carry target-site credentials, cookies, raw provider keys, or workload tokens; those remain outside the capture trace contract.
- Cost impact is one small HTTP API request plus one bounded Lambda invocation per capture completion, in addition to the already-required profile/S3/DynamoDB completion work.

### Tests / validation

AWS unit tests cover trusted scope derivation, cross-tenant suppression before completion work, malformed route/body rejection, missing tenant configuration, runtime bootstrap memoization, and sanitized failures. Packaging now requires both Lambda entrypoints, and immutable release validation rejects a control-plane ZIP that lacks the capture-completion entrypoint.

CI #182 passed deterministic lock verification, frozen installation, strict `pnpm check`, and both real production package builds. It then failed only in `scripts/test-release-aws-artifacts.sh`: the synthetic control-plane ZIP still contained the old single-entrypoint package shape, while the strengthened release validator correctly required `capture-completion-lambda.mjs`. The corrective change updates only that test fixture to model both packaged entrypoints; no production check, dependency gate, or validator is weakened.

This implementation, tests, packaging, IaC, and progress checkpoint are published as one coherent multi-file Git-data commit plus one root-caused corrective fixture commit. No package manifest or pnpm dependency graph changed. Exact-head GitHub Actions remains authoritative; this section does not claim the corrective head green until CI completes successfully.

## Next product milestones

1. Add a deployment wrapper that consumes the immutable release manifest plus environment-specific CloudFormation parameters and performs ordered stack deployment using short-lived AWS credentials; do not move environment secrets into the release manifest.
2. Wire a concrete capture worker/collector to the emitted `CaptureCompletionInvokeArn` so finishing Live View automatically sends the trusted trace callback; keep that worker permission scoped to the single IAM-authenticated route.
3. If real fresh tests commonly exceed the API Gateway request window, make fresh-test initiation asynchronous with a durable run ID and UI polling/history rather than increasing retries/timeouts.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract; passwords, cookies, provider keys, and equivalent secrets must never enter workflow/runtime-variable metadata.
- Public HTTP command idempotency is incomplete outside operations that already have durable domain idempotency; add explicit command keys where live UX can produce duplicate mutations.
- Automation status and EventBridge Scheduler state cannot be atomically committed across DynamoDB/Scheduler; lifecycle ordering fails closed, but a future reconciliation/status-repair path should make partial drift visible and repairable.
- The IAM-authenticated capture-completion route is provisioned, but the concrete capture event collector/worker that receives browser events and invokes it is still a deployment seam.
- Release upload is deliberately not transactional across both S3 objects. Partial upload produces no manifest/deployment authority but may leave an orphan object version until cleanup.
- Live OpenAI/SES/Cognito/AgentCore validation still requires the controlled AWS environment; deterministic CI is not represented as live-cloud proof.
- AgentCore Runtime/browser networking is PUBLIC for the arbitrary-web MVP and should be revisited where VPC egress can preserve target-site access.
- Notification delivery remains best-effort by design and does not become execution authority.
