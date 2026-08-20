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
- Completed capture traces now have durable AWS persistence using tenant-scoped DynamoDB metadata plus immutable S3 documents.
- Production fresh-test execution now has an AgentCore Runtime transport and execution-plane mode that reuses the hardened browser/BYOK worker without falling back to API-Lambda browser/model execution.
- `createAwsControlPlaneBootstrap` composes the production control-plane service graph from DynamoDB/S3 persistence, AgentCore Browser/Profile capture, AgentCore Identity credential management, AgentCore Runtime fresh tests, EventBridge Scheduler, Cognito-authenticated HTTP transport, and a separate trusted capture-completion handler.

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `904a6682a6b84944c89eb9bb0a60a1c8f6b29136` is green on GitHub Actions CI #172.
- GitHub Actions on the exact new head created by this run is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, AgentCore package smoke testing, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — production AWS control-plane composition

### Product slice

Added `createAwsControlPlaneBootstrap` as the concrete production composition boundary behind the already-existing API Gateway Lambda adapter. The bootstrap aggregates the deployment contracts for region, DynamoDB state, S3 artifacts, Cognito authorization, AgentCore Runtime fresh testing, and EventBridge Scheduler. Missing mandatory configuration returns one explicit `NOT_CONFIGURED` result before the control plane advertises cloud capability.

The configured graph now wires:

- `AwsDynamoAutomationRepository`, run/checkpoint state, and automation locks,
- immutable S3/Dynamo workflow versions and capture traces,
- durable capture-session state,
- AgentCore Browser Profiles plus Live View capture startup,
- the separate trusted capture-completion service that saves Browser Profile state before accepting a trace,
- AgentCore Identity credential storage plus sanitized credential metadata management,
- `AwsAgentCoreFreshTestExecutionPort` for production fresh tests outside the API Lambda,
- the real EventBridge Scheduler adapter used by lifecycle publish,
- Cognito-authenticated `AutomationControlPlaneHttpHandler` and the API Gateway payload-format 2.0 Lambda transport.

`AutomationProductLifecycleService` still has local browser/verifier/reasoner dependencies because local/mock mode uses them. In the production control-plane composition they are explicit fail-closed sentinels, while `cloudExecution = CONFIGURED` requires the AgentCore fresh-test port. The API path therefore cannot silently execute browser/model work inside Lambda if cloud composition regresses.

Trusted capture completion remains a separate returned handler rather than being registered in the ordinary Cognito end-user HTTP router. This preserves the existing deployment-authentication requirement for capture workers/callbacks.

### Correctness / security / tenancy / idempotency / retry / cost / observability review

- Authenticated tenant/user scope continues to come from the Cognito/API Gateway boundary; server-owned Browser Profile and AgentCore Identity references are resolved from authorized automation state rather than request JSON.
- Production fresh tests use the AgentCore Runtime invocation port and never fall through to local browser/model execution.
- Publishing now reaches the concrete Scheduler adapter through the existing lifecycle `scheduler.upsert` path, so schedule creation/update uses the same tenant-scoped resource identity and occurrence envelope already covered by scheduler tests.
- The bootstrap adds no whole-request retry around AgentCore fresh testing, capture startup, or Scheduler mutation. Existing execution-plane occurrence idempotency, locks, bounded workflow retries, and side-effect verification remain authoritative.
- Capture completion remains profile-save-before-trace and is not exposed through the JWT user route.
- BYOK raw keys continue to cross only the AgentCore Identity vault boundary; credential responses expose no secret reference or plaintext key.
- Notification capability is advertised only when both a configured SES sender and trusted Cognito user directory are present. Missing notification configuration does not prevent the rest of the control plane from being constructed.
- No package dependency, pnpm graph, table, bucket, queue, browser session, model call, CI artifact, or custom metric dimension was added by this composition slice. SDK clients are constructed lazily with the standard AWS credential provider chain and make no cloud calls during bootstrap.
- The deployable API Lambda resource/IAM role is deliberately still separate work: composition now knows the Runtime ARN and Scheduler resources, but deployment must grant only the required DynamoDB/S3/AgentCore/Identity/Scheduler/Runtime permissions rather than broadening this code boundary.

### Tests / validation

Regression coverage was added for aggregated production `NOT_CONFIGURED` state, construction of the full cloud-backed control-plane graph without AWS credentials or network calls, notification capability gating, and malformed AgentCore Runtime configuration rejection. The production composition is exported through `@automation/aws`.

This implementation, tests, and progress update are being published as one normal CI-triggering Git-data commit. Exact-head GitHub Actions remains authoritative; no pass is claimed until that run completes successfully.

## 2026-08-20 — AgentCore cloud fresh-test execution

### Product slice

Implemented the AWS `FreshTestExecutionPort` through the existing AgentCore Runtime rather than executing browser/model work in the API Lambda. The control-plane adapter invokes the deployed Runtime with a stable fresh-test session identity and sends the authenticated user only through AgentCore's dedicated `runtimeUserId` field. The JSON request contains only the execution discriminator, automation ID, run ID, and bounded runtime variables; it contains no tenant/user authorization fields, browser-profile reference, BYOK secret reference, provider key, or workload token.

The Runtime host now multiplexes explicit `FRESH_TEST` invocations and ordinary scheduled-dispatch invocations. Tenant scope remains deployment-owned by `AUTOMATION_TENANT_ID`; user scope comes from the managed Runtime user header; the Runtime-injected `WorkloadAccessToken` remains in-memory capability material used only by the credential vault boundary.

Fresh tests deliberately reuse the existing `ScheduledRunWorker` rather than creating a second browser execution implementation. `ScheduledRunCoordinator` now has an explicit provider-neutral preparation mode:

- `SCHEDULED` preserves the existing ACTIVE + published-workflow semantics and occurrence idempotency.
- `FRESH_TEST` accepts only `READY_TO_TEST`/`READY_TO_PUBLISH`, pins the latest immutable compiled workflow, uses the separate `automation:test:run` occurrence namespace, merges graph `initialVariables` with caller runtime variables before browser startup, and retains the same automation lock/lease boundary.

The BYOK composition now has a corresponding `createAwsByokFreshTestExecution` path. It reuses credential preflight, trusted invocation-scope validation, AgentCore Identity secret retrieval, Playwright execution/verification, checkpoint-coupled lease renewal, profile-save-before-success, bounded retries, and execution cleanup. Successful tests move the automation to `READY_TO_PUBLISH`; duplicate run IDs return the durable existing run/checkpoint without starting another browser session.

`createAwsScheduledRunBootstrap` now assembles both scheduled and fresh-test Runtime handlers from the same production repositories/session/runtime/credential graph. The current Runtime deployment therefore needs no second compute artifact or second secret path.

### Correctness / security / tenancy / idempotency / retry / cost / observability review

- Fresh tests execute outside the API Lambda and cannot silently fall back to the local lifecycle when cloud execution is configured.
- The control-plane adapter verifies its deployment tenant before invoking AgentCore. Tenant identity is omitted from the fresh-test JSON body; Runtime reconstructs tenant scope from deployment state and user scope from the managed invocation context.
- The workload token is never accepted from fresh-test JSON and is never returned to the control plane. It remains available only in the AgentCore Runtime invocation headers.
- A stable Runtime session ID is derived from tenant/user + automation + fresh-test run identity, while the durable run occurrence key remains `automationId:test:runId`. AgentCore transport identity is not treated as execution authority; DynamoDB run creation and the automation lock remain the final duplicate/side-effect boundary.
- No whole-invocation retry loop was added around `InvokeAgentRuntime`. An uncertain browser/model invocation is therefore not replayed blindly by the API process.
- Fresh tests use the same side-effect verification, bounded node retries, failure classification, browser profile persistence, lease renewal, and cleanup behavior as scheduled runs.
- Credential preflight blockers are durably checkpointed before browser startup, preserving seeded test variables and returning the run to human attention without paying AgentCore Browser/model cost.
- A concurrent test or scheduled run that already owns the automation lock cannot create a second active browser executor.
- Fresh-test request/response bodies are capped at 1 MiB, identifiers are bounded, Runtime user IDs preserve the platform's existing 128-character limit, and malformed Runtime responses fail closed.
- No package dependency, table, bucket, queue, model provider, CI artifact, or custom metric dimension was added; the existing `@aws-sdk/client-bedrock-agentcore` dependency is reused.
- The production control-plane Lambda/IAM resource is not yet composed, so the Runtime ARN and `InvokeAgentRuntime`/`InvokeAgentRuntimeForUser` permissions remain the next deployment wiring seam rather than being guessed into unrelated IaC.

### Tests / validation

Regression coverage added for:

- fresh-test preparation pinning the latest immutable workflow,
- captured initial-variable + runtime-variable seeding before browser execution,
- fresh-test occurrence deduplication,
- credential/preflight blocking with preserved test variables,
- rejection of ACTIVE/published automations through the fresh-test mode,
- AgentCore invocation using `runtimeUserId` while omitting tenant/workload credentials from JSON,
- stable fresh-test Runtime session identity,
- cross-tenant rejection before AgentCore invocation,
- explicit `NOT_CONFIGURED` Runtime deployment state,
- AgentCore Runtime routing of `FRESH_TEST` versus scheduled payloads.

This implementation, tests, and progress update are being published as one normal CI-triggering Git-data commit. Exact-head GitHub Actions remains authoritative; no pass is claimed until that run completes successfully.

## 2026-08-20 — production fresh-test execution boundary

### Product slice

The cloud-control-plane composition review found a correctness problem that had to be closed before wiring the real AWS service graph: `AutomationProductLifecycleService.runFreshTest()` owns an in-process `BrowserExecutor`, verifier, and reasoner. That is appropriate for local/mock mode, but production BYOK reasoning requires an AgentCore workload identity and production browser execution must happen in the execution plane, not inside the API Lambda.

Added the provider-neutral `FreshTestExecutionPort` as the explicit trusted production boundary. `AutomationControlPlaneService.runFreshTest()` now behaves differently by declared capability state:

- `cloudExecution = CONFIGURED` requires a configured `FreshTestExecutionPort` and never falls through to the local lifecycle executor.
- `cloudExecution = LOCAL_MOCK` continues using the existing in-process lifecycle implementation so deterministic local tests remain unchanged.
- a production deployment claiming configured cloud execution without the trusted port fails closed with `NOT_CONFIGURED` before any local browser/model work or run mutation can occur.

The port receives only the already-authenticated ownership scope, automation ID, run ID, and bounded runtime variables. Its contract explicitly requires production implementations to obtain workload identity/secret capability from trusted cloud invocation context rather than request JSON.

### Correctness / security / tenancy / idempotency / retry / cost / observability review

- The control-plane API process can no longer silently perform production fresh-test browser/model execution when `cloudExecution` advertises `CONFIGURED`.
- Tenant/user ownership remains sourced from authenticated control-plane context and is passed unchanged through the fresh-test boundary.
- Browser-profile references, BYOK secret references, workload tokens, and provider keys are not added to the fresh-test request contract.
- No new retry layer is introduced. The cloud executor reuses the execution-plane idempotency/run semantics rather than retrying an uncertain whole browser test from the API Lambda.
- Local/mock behavior is preserved explicitly instead of being inferred from missing cloud dependencies.

### Tests / validation

Regression coverage added for production fail-closed behavior, suppression of local browser/model execution, trusted cloud-port routing, local/mock preservation, and runtime-variable forwarding.

The implementation was published on `6255452ac03f69634d42e726b53ea6322a5a7ab5`. CI #170 stopped only at the deterministic pnpm supply-chain gate after upstream transitive lock drift with no package-manifest change. Corrective head `6dcf6301f7f751c058d28c1baf4b044a1b0b8f8b` pinned the CI-generated reviewed graph and passed CI #171 completely.

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

Regression coverage added for canonical stable capture serialization, DynamoDB metadata + immutable S3 trace persistence, replacement rejection, S3-before-Dynamo recovery, conflicting orphan rejection, capture-order listing, and cross-tenant isolation.

Normal implementation head `b1e2fb618387e851cd7b13d2a17e28a4baff3d6c` reached CI #168 with only one invalid ordering fixture failing; corrective head `6481a184a1526345efc512cec304ed50dfe65f2d` fixed only the fixture and passed CI #169.

## Next product milestones

1. Add the deployable control-plane Lambda resource/IAM role and wire the AgentCore Runtime ARN plus DynamoDB/S3/Browser/Profile/Identity/Scheduler permissions with least privilege; keep Runtime workload tokens out of API payloads.
2. Add explicit update/disable lifecycle commands so schedule changes and pausing automatically update/disable the deployed EventBridge Scheduler resource. Publish already reaches the concrete Scheduler adapter through this control-plane composition.
3. Add the Runtime artifact upload/deploy release command around the tested ZIP, requiring a versioned S3 object in production.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The cloud-backed `AutomationControlPlaneService` graph is now composed in code, but the deployable control-plane Lambda resource/IAM role and deployment wrapper are still required before a live API can use it.
- `AwsAgentCoreFreshTestExecutionPort` is now injected by the production control-plane bootstrap, but the future API Lambda role must still grant the exact AgentCore Runtime invocation capability before production can advertise this deployment as live.
- Trusted capture-completion worker authentication remains a separate deployment boundary; it must not be exposed through the ordinary end-user JWT route.
- The Runtime resource/package is represented in code/IaC, but live creation and invocation still require a controlled AWS deployment and uploaded Runtime ZIP; CI intentionally uses no cloud credentials.
- `PUBLIC` Runtime networking is suitable for the arbitrary-web MVP but should be revisited for production environments that can provide VPC egress without breaking permitted target-site access.
- Cognito directory reads are eventually consistent, so notification delivery for a just-created account can be delayed; execution remains unaffected.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Live OpenAI/SES/Cognito/AgentCore validation remains pending the controlled AWS environment; deterministic CI tests are not represented as live-cloud proof.
