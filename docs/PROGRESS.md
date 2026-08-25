# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `732e7729642cdac44d91e0fc37f42150c5792ed2` (`Keep capture start identity server-side`).
- GitHub Actions CI #320 completed successfully on that exact SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline/reasoning summaries, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — make the browser Capture-start type match the public API

### Product/security gap

The authenticated Capture-start HTTP response already strips the durable `captureSessionId`, but `WebControlPlaneClient.capture()` was still typed as the internal provider-neutral `CaptureStartResult`, whose READY variant requires that server-owned identifier. Runtime behavior was safe, but the browser-facing TypeScript contract lied about what crosses the boundary and could encourage future UI code to depend on a field that is intentionally absent.

### Change

- Added a dedicated browser-facing `WebCaptureStartResult` type in the Next.js control-plane client.
- READY contains only `kind`, the short-lived `liveViewUrl` capability, and `expiresAt`.
- NOT_CONFIGURED retains only the existing sanitized reason.
- `WebControlPlaneClient.capture()` now returns that public type instead of the internal capture-service result type.
- Added a regression whose type-level key check fails compilation if `captureSessionId` is ever reintroduced into the READY browser contract, plus runtime verification of the exact response shape and encoded automation path.

## Security / tenancy review

- Tenant/user ownership is still enforced by the authenticated control-plane request and existing automation lookup before capture startup.
- Durable capture-session identity, Browser session identity, Browser Profile references, trace identity, collector state, and completion authority remain server-side.
- The Live View URL remains intentionally user-visible capability material because the owner must interact with the isolated browser. Existing HTTPS, bounded lifetime, no-store/no-referrer handoff protections remain unchanged.
- No CAPTCHA, MFA, anti-bot, or other third-party security control is bypassed.

## Idempotency / concurrency / retry / timeout

- No capture claim, DynamoDB conditional write, duplicate-capture suppression, collector launch, Browser allocation, retry, or timeout behavior changed.
- The existing current-capture pointer remains the durable concurrency authority.
- This is a transport/type-boundary correction only; it cannot create or replay a capture operation.

## Side-effect verification / recovery

- Capture completion ordering remains Browser Profile save -> immutable trace persistence -> durable capture completion -> ephemeral browser stop.
- Workflow compilation, Fresh Test, scheduled execution, side-effect verification, human takeover/resume, leases, heartbeat, and reconciliation are unchanged.
- No recovery authority is derived from the browser-facing Capture-start response.

## Cost / observability

- No additional DynamoDB, S3, AgentCore Browser, AgentCore Runtime, OpenAI, Scheduler, SQS, Step Functions, SES, or CloudWatch call is introduced.
- No dependency, IAM permission, AWS resource, table/index, persistence schema, GitHub Actions artifact, or retained storage is added.
- The compile-time boundary reduces the chance of future accidental client coupling to durable capture identity without changing runtime cost.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new browser-facing Capture-start contract regression.

Do not claim this slice green until GitHub Actions completes successfully on the exact published head.

## Known production risks / deliberately parked work

- The protected real AWS deployment/full vertical demonstration still has not been completed with real Environment/OIDC/VPC inputs.
- VPC AgentCore Browser route-table/DNS/security-group/firewall containment still requires live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Cognito/Google federation, SES delivery and AgentCore Runtime/Browser behavior are structurally tested but still need live-service validation.
- OpenAI is the only concrete production BYOK reasoning adapter today; the core remains provider-neutral for later adapters.
- DynamoDB and EventBridge Scheduler mutations remain separate fail-closed systems rather than one transaction; live operation must validate reconciliation expectations.
- Automation settings still use ordinary repository read/modify/write semantics; broad CAS machinery remains parked unless live concurrency shows material loss.
- Evidence screenshots are intentionally owner-visible and may contain ordinary page data. Evidence retention/deletion policy should be revisited after live usage establishes operational needs.
- Reasoning summaries intentionally describe only accepted constrained decisions. They are not chain-of-thought and should not be expanded into raw model rationale later.
- The internal provider-neutral `CaptureStartResult` still includes the durable session identity because AWS capture composition needs it. Transport adapters must keep using a distinct public type and must not re-expose that identity.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. Cognito/Google sign-in;
4. configure OpenAI BYOK;
5. AgentCore Live View capture and trusted completion, verifying the browser receives only the short-lived Live View capability/expiry and no durable capture-session identity;
6. compile and inspect the semantic plan;
7. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
8. inspect the ordered execution timeline, bounded semantic decisions, and authenticated evidence;
9. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
10. verify run history, SES notification and CloudWatch telemetry;
11. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
