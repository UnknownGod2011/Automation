# Progress Log

This file is the continuity checkpoint for automated development runs. Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before changing implementation boundaries.

## Product/lifecycle target

create automation -> capture -> compile -> test -> publish -> schedule -> execute -> reason -> verify -> checkpoint -> retry/pause -> human recovery -> resume -> success.

Core orchestration remains provider-neutral. AWS is the first production adapter; Google must remain implementable behind the same contracts. Product completion takes precedence over further recovery micro-hardening unless an end-to-end slice or CI exposes a concrete recovery defect.

## Completed product foundation

- Strict TypeScript/pnpm monorepo with deterministic dependency bootstrap, pinned Node/pnpm versions, reviewed lock SHA-256, and the prior AWS DynamoDB peer mismatch resolved rather than suppressed.
- Provider-neutral workflow/run/failure contracts, bounded retries, explicit side-effect verification, checkpointing, occurrence idempotency, tenant ownership, and in-memory adapters.
- Deep execution/human-recovery substrate: human-resolution claims, execution leases, heartbeat fencing, redacted audit history, read-only effect reconciliation, and atomic already-applied recovery primitives. Narrower recovery work is parked.
- Versioned capture trace contracts and `compileCaptureTrace` produce semantic `WorkflowGraph` definitions with deterministic selectors first, explicit verification, bounded retries, fresh-session navigation, and safe initial variables.
- `AutomationProductLifecycleService` proves local/mock create -> capture -> compile -> fresh test -> publish -> scheduled dispatch -> execution -> history without cloud credentials.
- Provider-neutral control-plane HTTP contracts plus `apps/web` provide dashboard/create/capture/compile/test/publish/history and authenticated BYOK credential UX.
- AgentCore Live View capture startup restores a server-owned Browser Profile. Durable capture completion saves authenticated profile state before accepting the trace and exposes only safe latest-capture readiness metadata to the UI.
- Cognito managed login protects the Next.js/control-plane perimeter with authorization-code + PKCE sessions and API Gateway-verified Cognito access-token claims.
- AgentCore Identity-backed BYOK plus authenticated credential settings keep raw provider keys outside ordinary metadata tables and select credentials through a deterministic provider-neutral pool.
- OpenAI BYOK reasoning uses the fixed Responses API endpoint, structured output, local policy revalidation, bounded context/network/output limits, and sanitized failure classification.
- EventBridge Scheduler -> SQS -> dispatcher -> Step Functions Standard provides buffered at-least-once scheduling with occurrence-derived idempotency, bounded transport retries, DLQ/backpressure, and IaC.
- `AwsScheduledRunHandler` binds trusted occurrence scope, AgentCore workload identity, deterministic occurrence run identity, OpenAI BYOK reasoning, browser execution, and durable outcome reporting.
- SES/CloudWatch reporting records sanitized success/failure/attention outcomes without becoming execution authority.
- `createAwsScheduledRunBootstrap` assembles DynamoDB state, immutable S3 workflows/evidence, AgentCore Browser/Profile, AgentCore Identity BYOK, Playwright execution/verification, OpenAI reasoning, and reporting.
- Step Functions invokes AgentCore Runtime rather than a browser Lambda. The Runtime is packageable as a Node 22 direct-code artifact and provisioned by `infra/aws/agentcore-runtime.yaml` with bounded compute lifetime and least-privilege execution access.
- Cognito-backed scheduled notification recipient resolution uses the trusted user `sub`, verified email, and deployment-owned user-pool configuration; scheduled payloads cannot select destinations.
- API Gateway HTTP API payload-format 2.0 transport maps already-verified Cognito claims to the provider-neutral control-plane handler without parsing raw bearer tokens or trusting request-supplied ownership.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `59d73fac079e4ecaa412ea356bf16d205be747a2` is green on GitHub Actions CI #167.
- GitHub Actions on the exact new head created by this run is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, AgentCore package smoke testing, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — immutable AWS capture-trace persistence

### Product slice

During composition review, a concrete cloud-control-plane gap was found: capture-session completion was durable in DynamoDB and workflow versions were durable in S3, but there was no production `CaptureTraceRepository`. The local lifecycle therefore could not be assembled against real AWS persistence without substituting an in-memory capture store.

Added `AwsCaptureTraceRepository`. Capture-trace metadata is stored under the existing tenant/user-scoped DynamoDB partition, while the full validated trace document is stored as immutable JSON in the configured S3 artifact bucket. Object keys use hashed scope/automation/trace identities rather than raw tenant, user, or trace identifiers.

The write sequence is deliberately recoverable: canonical trace bytes are written to S3 with the existing create-only document API before conditional DynamoDB metadata is created. If S3 succeeds and the metadata write fails, an exact retry verifies the orphaned S3 bytes and can safely finish metadata creation. If the orphaned document differs, the repository fails closed rather than attaching metadata to the wrong trace.

Reads use strongly consistent DynamoDB metadata lookup, fetch the referenced immutable S3 document, run `assertCaptureTrace`, and revalidate tenant/user/automation/trace identity. Listing queries only the caller's ownership partition and then validates every referenced document before returning capture-ordered results.

### Correctness / security / tenancy / idempotency / retry / cost / observability review

- Raw capture content remains outside DynamoDB; only bounded control metadata and the S3 object key are stored in the state table.
- S3 object paths do not expose tenant ID, user ID, automation ID, or trace ID. The bucket/prefix/KMS policy remains the deployment security boundary.
- Existing capture artifacts referenced by the trace remain references; this repository does not duplicate screenshots/recordings into DynamoDB.
- Capture replacement is forbidden. A trace ID is immutable, and a metadata collision never becomes an overwrite.
- The S3-before-Dynamo ordering intentionally supports the already-existing trusted capture-completion replay behavior after acknowledgement uncertainty.
- Cross-tenant reads cannot discover metadata because partition identity is scope-derived; document identity is revalidated after S3 decode as defense in depth.
- Transport/storage failures propagate. There is no retry loop that could duplicate browser actions because this adapter persists completed capture evidence only.
- Listing incurs one DynamoDB query plus one S3 read per trace. This is acceptable for the capture/compile control path; dashboard readiness continues to use the cheaper latest-capture pointer rather than listing trace documents.
- No dependency, CI artifact, new table, new bucket, model call, browser session, or metric dimension was added.

### Tests / validation

Regression coverage added for:

- canonical stable capture serialization,
- DynamoDB metadata + immutable S3 trace persistence,
- replacement rejection,
- recovery when S3 succeeds before a transient metadata failure,
- conflicting orphan-document rejection,
- capture-order listing,
- cross-tenant isolation.

Normal implementation head `b1e2fb618387e851cd7b13d2a17e28a4baff3d6c` reached GitHub Actions CI #168. Deterministic lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, the Next.js production build, all 7 contracts tests, all 146 core tests, all 17 web tests, and 184/185 AWS tests passed. The sole failure was the newly-added capture-order test fixture: it moved `startedAt` to 11:00 while leaving `finishedAt` fixed at 10:01, so the existing `assertCaptureTrace` contract correctly rejected the invalid trace before repository logic ran. The production adapter and its other six new tests were not implicated.

The single permitted corrective commit changes only the fixture time construction so `finishedAt` and the event timestamp are derived from the supplied `startedAt`, and records this root cause. No runtime behavior, contract, compiler setting, dependency, or CI gate is weakened. Exact-head GitHub Actions after the correction remains authoritative.

## Next product milestones

1. Compose the concrete production `AutomationControlPlaneService` graph behind the existing Lambda transport using DynamoDB automation/run state, this S3/Dynamo capture repository, S3 workflow versions, AgentCore Browser/Profile capture startup, capture completion state, AgentCore Identity credential management, and the real Scheduler port, with aggregated `NOT_CONFIGURED` deployment state.
2. Resolve the production fresh-test execution seam correctly: the local lifecycle assumes an in-process browser/reasoner, while production BYOK reasoning requires AgentCore workload identity. Fresh tests should execute through an explicit trusted cloud execution boundary rather than allocating AgentCore Browser/model work inside the API Lambda or mutating a run before discovering credentials are unavailable.
3. Wire publish/update/disable lifecycle operations to deployed EventBridge Scheduler resources automatically, using stack outputs for dispatch queue/role/group rather than manual environment assembly.
4. Add the Runtime artifact upload/deploy release command around the tested ZIP, requiring a versioned S3 object in production.
5. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
6. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The API Gateway Lambda transport is defined, but the complete cloud-backed `AutomationControlPlaneService` composition and deployable control-plane Lambda resource remain in progress.
- Production fresh tests must not reuse the local in-process browser/reasoner assumption; they need a trusted AgentCore Runtime/workload-identity execution boundary before publish can be fully cloud-native.
- Trusted capture-completion worker authentication remains a separate deployment boundary; it must not be exposed through the ordinary end-user JWT route.
- The Runtime resource/package is represented in code/IaC, but live creation and invocation still require a controlled AWS deployment and uploaded Runtime ZIP; CI intentionally uses no cloud credentials.
- `PUBLIC` Runtime networking is suitable for the arbitrary-web MVP but should be revisited for production environments that can provide VPC egress without breaking permitted target-site access.
- Cognito directory reads are eventually consistent, so notification delivery for a just-created account can be delayed; execution remains unaffected.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Live OpenAI/SES/Cognito/AgentCore validation remains pending the controlled AWS environment; deterministic CI tests are not represented as live-cloud proof.
