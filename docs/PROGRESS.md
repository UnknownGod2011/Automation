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

## Authoritative incoming validation

- PR #1 is the open draft development PR on `agent/bootstrap-platform`.
- Incoming head `e8b02c834eb3695061049f9e31d756b48771fc78` is green on GitHub Actions CI #164.
- GitHub Actions on the exact new head created by this run is authoritative. Do not claim this slice green until deterministic lock verification, frozen install, `pnpm check`, AgentCore package smoke testing, Next.js build/type validation, and the complete test suite have succeeded.

## 2026-08-20 — trusted Cognito notification directory

### Product slice

Closed the remaining production email-recipient seam for scheduled execution.

Added `AwsCognitoUserEmailResolver`, a deployment-owned `SesRecipientResolver` backed by the Cognito user pool. Scheduled JSON never supplies an email address. The resolver accepts only the already-trusted ownership scope/user ID, performs an exact server-side Cognito `sub` lookup, revalidates the durable returned `sub`, requires the account to be enabled, and returns an email only when Cognito marks `email_verified=true`.

`createAwsScheduledRunReporting` now automatically uses that Cognito resolver when `AUTOMATION_COGNITO_USER_POOL_ID` is configured, while preserving an explicit resolver override for tests or a future non-Cognito directory. Missing Cognito configuration remains an explicit notification `NOT_CONFIGURED` state; telemetry and scheduled execution remain available.

`infra/aws/control-plane-auth.yaml` now exports the concrete Cognito user-pool ID. `infra/aws/agentcore-runtime.yaml` accepts that output as an optional input, passes it to the worker as `AUTOMATION_COGNITO_USER_POOL_ID`, and grants only `cognito-idp:ListUsers` on that exact user-pool ARN when configured. The runtime receives no Cognito write/admin mutation permissions.

The AWS package now pins `@aws-sdk/client-cognito-identity-provider@3.1111.0`, matching the already-reviewed AWS SDK line. Because this changes the dependency graph, the first exact-head CI run is expected to stop at the deterministic lock-review gate until the newly generated lock SHA is inspected and, if correct, authenticated in the single allowed corrective commit.

### Correctness / security / tenancy / idempotency / retry / cost / observability review

- Notification ownership remains tenant/user scoped. Cross-user routing is rejected before the Cognito API is called.
- The scheduled payload cannot select an email, user pool, or alternate Cognito subject. User pool identity is deployment configuration; user identity is the trusted Runtime/control-plane subject.
- Only verified email is eligible. Disabled, missing, unverified, mismatched, or ambiguous users produce no destination or fail closed.
- Cognito `ListUsers` is eventually consistent. A newly-created user may temporarily miss an email notification; reporting is already best-effort and cannot change run state, retry browser/model actions, or manufacture execution success.
- Cognito/SES outages propagate through the existing best-effort reporting boundary and do not become workflow retry authority.
- One exact-sub directory read is performed only for notification outcomes that actually send email. This adds small per-notification Cognito API cost/latency but no browser/model compute.
- No email, Cognito attributes, BYOK key, workload token, browser state, or raw provider exception is added to run/checkpoint telemetry.
- The Runtime role receives only read access to the configured user pool. Credential and browser permissions are unchanged.

### Tests / validation

Regression coverage now proves:

- explicit Cognito user-pool configuration and malformed configuration rejection,
- exact-sub lookup and verified-email resolution,
- cross-user rejection before AWS network access,
- disabled/unverified/missing users returning no destination,
- ambiguous or mismatched Cognito identities failing closed,
- reporting auto-composition through Cognito while preserving the explicit resolver override,
- production bootstrap showing notifications configured only when sender + Cognito directory configuration are present.

Validation status for this slice: implementation, tests, AWS exports, IAM/environment wiring, auth-stack output, and this progress update are being published as one normal CI-triggering Git-data commit. Exact-head GitHub Actions is authoritative; no pass is claimed here until it exists.

## Next product milestones

1. Compose the concrete control-plane Lambda/API handler from API Gateway verified Cognito claims and the existing provider-neutral `AutomationControlPlaneHttpHandler`, using DynamoDB/S3/AgentCore adapters with explicit `NOT_CONFIGURED` deployment states.
2. Wire stack outputs together so publishing an automation creates/updates the real EventBridge Scheduler resource using the deployed Runtime/SQS/Step Functions resources rather than manually supplied environment values.
3. Add the Runtime artifact upload/deploy release command around the tested ZIP, requiring a versioned S3 object in production.
4. Perform one controlled real AWS demonstration: sign in -> BYOK -> capture -> compile/test -> publish -> schedule -> AgentCore cloud browser/OpenAI execution -> verification/history/email, plus one bounded human takeover/resume path.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrably complete.

## Known parked limitations

- Recovery continuation consumption remains parked until a production cloud worker integration specifically requires it.
- Sensitive target-site runtime values still need a separate secret-resolution contract; never place passwords, cookies, provider keys, or equivalent secrets in workflow/runtime-variable metadata.
- The Runtime resource/package is represented in code/IaC, but live creation and invocation still require a controlled AWS deployment and uploaded Runtime ZIP; CI intentionally uses no cloud credentials.
- `PUBLIC` Runtime networking is suitable for the arbitrary-web MVP but should be revisited for production environments that can provide VPC egress without breaking permitted target-site access.
- Cognito directory reads are eventually consistent, so notification delivery for a just-created account can be delayed; execution remains unaffected.
- Notification delivery is intentionally best-effort rather than durable/outboxed; add durable notification retry only if live deployment demonstrates a product need.
- Public HTTP command idempotency, deployment-level capture-worker authentication middleware, and broader production API rate limiting remain control-plane work.
- Live OpenAI/SES/Cognito/AgentCore validation remains pending the controlled AWS environment; deterministic CI tests are not represented as live-cloud proof.
