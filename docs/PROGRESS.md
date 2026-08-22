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
- Incoming head `84a535feabb668de4e25a7beb074187124882c77` (`Block private cloud browser targets`) is green on GitHub Actions CI #230.
- This slice makes the protected AWS deployment path require and verify a deployment-owned VPC custom AgentCore Browser before any CloudFormation mutation. GitHub Actions on the exact new head remains authoritative; no pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — require a VPC custom AgentCore Browser for protected deployment

The preceding application-layer target policy rejects explicit localhost/private/link-local/control-plane destinations before Browser Profile allocation. That remains useful, but it cannot stop DNS rebinding or a public page redirecting toward an internal address. The protected AWS release path previously still accepted the AWS-managed `aws.browser.v1` browser and did not inspect the live Browser network configuration before deployment.

The ordered deployment script now requires `parameters.runtime.AgentCoreBrowserIdentifier` and `AgentCoreBrowserResourceArn` to identify the same account-owned custom AgentCore Browser in the deployment region. The AWS-managed browser is rejected by the protected deployer. Before the first CloudFormation mutation, the deployer performs a read-only `bedrock-agentcore-control get-browser` and requires the returned identity to match exactly, status to be `READY`, `networkConfiguration.networkMode` to be `VPC`, and the VPC configuration to contain non-empty security-group and subnet lists.

The browser identity is then treated as derived deployment authority: the same verified identifier is supplied to the control-plane stack, and environment configuration cannot independently override the control-plane Browser identifier. The final non-secret deployment result also records the exact verified Browser identifier and ARN for operational traceability.

This is intentionally a prerequisite rather than a claim that `VPC` mode alone proves safe internet egress. The actual VPC route tables, security groups, DNS behavior, firewall/proxy controls, and any allow/deny policy still need live validation to ensure private/link-local/control-plane destinations remain unreachable after DNS resolution and redirects.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** protected deployments no longer accept the service-managed public Browser. The live custom Browser identity, readiness, and VPC network mode are checked before infrastructure mutation. This adds a second deployment/network layer behind the provider-neutral target URL guard without weakening either boundary.
- **Tenant isolation:** unchanged. The Browser is deployment-owned infrastructure; automation/run ownership remains tenant/user scoped in application state. The control plane and execution plane are now forced to use the same verified Browser identifier.
- **Idempotency/concurrency:** unchanged. Browser inspection is read-only and occurs before stack mutation. Exact deployment reruns continue to rely on CloudFormation idempotency and immutable release artifacts.
- **Retry/timeout:** no new retry loop was added. If Browser inspection is unavailable, mismatched, not READY, or not VPC-backed, deployment fails closed rather than guessing.
- **Side-effect verification:** workflow effect verification is unchanged. This slice only constrains the cloud Browser resource through which effects are executed.
- **Cost:** one bounded control-plane Browser lookup is added per deployment. A rejected configuration fails before CloudFormation changes or browser/model execution cost.
- **Observability:** the deployment result records only the non-secret Browser ID/ARN. It does not expose Browser Profiles, session IDs, Live View credentials, BYOK material, or workload tokens.
- **User recovery:** unchanged. Existing target-auth takeover/resume continues to use the same deployment Browser/Profile boundary.

### Validation added

- The no-cloud deployment contract now supplies a realistic custom AgentCore Browser ID/ARN and verifies Browser inspection happens before the first CloudFormation deploy.
- A `READY` VPC browser with non-empty security groups/subnets is accepted and its identifier is derived into the control-plane deployment.
- A `PUBLIC` browser fails before any CloudFormation mutation.
- The AWS-managed `aws.browser.v1` path fails locally before any AWS call.
- An environment attempt to independently override the control-plane Browser identifier fails before any AWS call.
- Existing derived callback/stack-output protections remain covered.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> automatically observed durable Fresh Test result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for this VPC-browser deployment slice; fix only root-caused failures without weakening checks.
2. Configure a real custom AgentCore Browser in VPC mode with deployment-owned subnets/security groups and run the protected deployment workflow; require the live public/auth smoke gate to pass.
3. Validate the live Browser network path against private/link-local/control-plane destinations after DNS resolution and redirects. If VPC routing/security groups alone cannot enforce the required internet/private separation, add an explicit egress proxy/firewall or domain allowlist before broad arbitrary-host production use.
4. Exercise a Fresh Test that intentionally runs longer than 30 seconds and verify the request returns promptly, the page follows durable run state, and the final result appears without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- VPC Browser mode is now required by the protected deployer, but the repository cannot prove an environment's route tables, DNS controls, security groups, firewall/proxy behavior, or redirect-time destination resolution without live AWS validation. Do not treat `networkMode=VPC` by itself as complete SSRF containment.
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
