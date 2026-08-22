# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical slices remain available in Git; this file is intentionally consolidated around the current production state and the latest outward-facing work.

## Product target

sign in with email or Google -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop. Long-running Fresh Tests are acknowledged asynchronously and the page follows durable status with bounded polling.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Scheduled execution checkpoints are seeded before browser startup from immutable graph variables, bounded persisted non-secret scheduled capture inputs, and any explicit invocation override.
- Optional Google federation preserves `email_verified` into Cognito, and the controlled demo includes a read-only verification command before Google-backed SES evidence is trusted.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `072960d09b6b6556747f53b75f558599b7800f16` (`Provision VPC AgentCore Browser in deployment`) is green on GitHub Actions CI #232.
- This slice binds semantic/model recovery to both the immutable workflow goal and the current constrained step. GitHub Actions on the exact new head remains authoritative; no pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — preserve the workflow goal during semantic recovery

A production-path audit of the real Fresh Test/scheduled execution flow found that the execution engine passed only `node.objective` into `ReasoningProvider`. The OpenAI BYOK adapter labels that field as the workflow objective, so semantic recovery after UI drift could lose the user's actual immutable automation goal and receive only a local step description. This is especially weak for captured workflows whose node intent may be deliberately generic or structural.

Semantic recovery now receives a bounded provider-neutral objective containing both authorities: the immutable `WorkflowGraph.objective` and the current `WorkflowNode.objective`. The allowed-action set is unchanged and remains derived from the immutable node, so adding the global goal cannot broaden browser permissions. Browser/page context remains the separately constrained untrusted context sent to the provider.

A focused execution regression drives a deterministic click failure into semantic recovery and proves the reasoner receives the workflow goal plus current-step intent, while the permitted semantic action remains exactly `CLICK` and tenant/user identifiers are not embedded into the objective.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** this change adds only user-authored workflow intent already stored in the immutable graph. It does not add cookies, Browser Profile data, credentials, tenant identifiers, provider secrets, or page content to the objective. Model output remains locally validated against the node's allowed action boundary.
- **Tenant isolation:** unchanged. The reasoner still receives the existing trusted ownership scope for server-side credential routing, while the human-readable objective does not embed tenant/user identifiers.
- **Idempotency/concurrency:** unchanged. Run occurrence identity, automation leases, checkpointing, and duplicate suppression are unaffected.
- **Retry/timeout:** unchanged. Semantic fallback still occurs only at the existing bounded recovery boundary and uses the provider's configured network/output limits.
- **Side-effect verification:** unchanged and still mandatory. A semantically recovered action must satisfy the node's existing verification contract before the engine advances.
- **Cost:** no additional model call is introduced; an existing semantic call receives slightly more bounded instruction context.
- **Observability:** no new logs or metrics are added. The provider continues returning only a short observable summary rather than chain-of-thought.
- **User recovery:** unchanged. If semantic recovery still cannot satisfy the declared effect, existing bounded retry/human-attention behavior remains authoritative.

### Validation added

- Semantic recovery is exercised after a recoverable deterministic `ELEMENT_NOT_FOUND` failure.
- The reasoning request must contain the immutable workflow goal and current step intent.
- The reasoner's allowed action remains constrained to the current workflow node.
- Tenant/user identifiers are not copied into the reasoning objective.

## 2026-08-22 — provision the protected VPC AgentCore Browser in the release deployment

The preceding slice correctly required a deployment-owned custom AgentCore Browser in VPC mode, but it still expected operators to create that Browser out-of-band and paste its generated ID/ARN into deployment configuration. That left the protected vertical deployment dependent on a manually created cloud resource and made the release definition less reproducible than the Runtime, Scheduler, control plane, and web stacks.

AWS CloudFormation now exposes `AWS::BedrockAgentCore::BrowserCustom`, including VPC network configuration and stable `BrowserId`/`BrowserArn` outputs. The release deployer now owns that resource through `infra/aws/agentcore-browser.yaml`.

Environment configuration supplies only the intended Browser name plus existing VPC security-group/subnet IDs. `NetworkMode` is fixed to `VPC` in the template and cannot be selected from environment JSON. The deployer creates/updates the Browser stack first, derives the returned Browser ID/ARN from CloudFormation outputs, validates their shape/region, then performs a read-only `bedrock-agentcore-control get-browser` and requires the live resource to be `READY`, still report `VPC`, and retain non-empty VPC security-group/subnet configuration before any application stack receives Browser authority.

The derived Browser identity is supplied to both AgentCore Runtime and the control-plane service. Environment configuration is forbidden from independently overriding `AgentCoreBrowserIdentifier` or `AgentCoreBrowserResourceArn`. The deployment result records the non-secret Browser stack name plus exact Browser ID/ARN for operational correlation.

This closes a product/deployment seam; it does not claim that VPC mode alone provides complete SSRF containment. Route tables, DNS behavior, security groups, network ACLs, firewall/proxy controls, and redirect-time resolution still require live validation.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the protected release no longer accepts a manually pasted Browser identity or public Browser mode. Browser authority is stack-derived from a template hard-coded to VPC mode, then independently checked against the AgentCore control plane before downstream deployment.
- **Tenant isolation:** unchanged. The Browser is deployment-owned shared infrastructure; automations, profiles, runs, credentials, and human-resolution state remain tenant/user scoped. Runtime and control plane receive the same derived Browser ID.
- **Idempotency/concurrency:** Browser lifecycle now inherits CloudFormation idempotency. Re-running an unchanged release/environment converges on the same Browser stack. Network-configuration changes may replace the Browser as defined by AWS; downstream stacks receive the newly derived identity only after readiness validation.
- **Retry/timeout:** no retry loop was added. Invalid VPC identifiers fail locally before AWS access; Browser creation/update or readiness uncertainty fails the deployment rather than being guessed.
- **Side-effect verification:** workflow verification semantics are unchanged. This slice only provisions the execution Browser boundary.
- **Cost:** one CloudFormation Browser resource and one read-only Browser inspection are added to deployment. Browser/model session cost remains execution-driven; a Browser readiness failure stops before the rest of the application stacks are changed in that run.
- **Observability:** deployment output records only stack name and Browser ID/ARN. Browser Profiles, sessions, Live View URLs, BYOK secrets, workload tokens, and browser contents remain excluded.
- **User recovery:** unchanged. Capture, fresh/scheduled execution, and target-auth takeover/resume automatically use the same deployment-derived Browser.

### Validation added

- The no-cloud deployment contract statically requires `AWS::BedrockAgentCore::BrowserCustom`, `NetworkMode: VPC`, and the configured VPC security-group/subnet inputs.
- Deployment order now begins with the Browser stack and verifies live Browser state before web/auth/runtime/application stacks.
- Browser ID/ARN are derived from stack outputs and forwarded to both Runtime and control plane.
- Invalid security-group/subnet identifiers fail before any AWS call.
- A simulated live `PUBLIC` Browser state fails after the isolated Browser stack and before any application stack deployment.
- Runtime/control-plane attempts to override the derived Browser identifier fail before AWS access.
- Existing callback, artifact-version, release-ordering, packaging, and deployment-derived-value protections remain covered.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, provisions the VPC custom AgentCore Browser, deploys application stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> automatically observed durable Fresh Test result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for the semantic-objective slice; fix only root-caused failures without weakening checks.
2. Run the protected deployment workflow with real VPC subnet/security-group IDs; require Browser creation/readiness validation and the live public/auth smoke gate to pass.
3. Validate the live Browser network path against private/link-local/control-plane destinations after DNS resolution and redirects. If VPC routing/security groups alone cannot enforce the required internet/private separation, add an explicit egress proxy/firewall or domain allowlist before broad arbitrary-host production use.
4. Exercise a Fresh Test that intentionally runs longer than 30 seconds and verify the request returns promptly, the page follows durable run state, and the final result appears without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- VPC Browser mode is deployment-enforced, but the repository cannot prove an environment's route tables, DNS controls, security groups, network ACLs, firewall/proxy behavior, or redirect-time destination resolution without live AWS validation. Do not treat `networkMode=VPC` by itself as complete SSRF containment.
- Changing Browser VPC networking can require replacement of the custom Browser. Deployment must validate Browser readiness before downstream stacks switch to the new identity; existing long-lived Browser Profile compatibility should be checked in the real environment before production network migrations.
- Application-layer target validation blocks explicit private/local hosts but cannot by itself stop DNS rebinding or redirect-to-private behavior; retain it as defense in depth.
- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain the cross-process authority. Harden only if live Runtime replacement demonstrates a concrete duplicate-start defect.
- Fresh Test page polling is bounded to five minutes; longer tests remain valid and can be followed through manual refresh/run diagnostics.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates infrastructure/tooling but cannot prove a live external OAuth exchange without deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
