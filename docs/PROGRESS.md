# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `9ea3b0f68550c26379dd7fd26c402893f41eebef` (`Add bounded run reasoning summaries`).
- GitHub Actions CI #318 completed successfully on that exact `main` SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline/reasoning summaries, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — keep capture-start identity server-side

### Product/security gap

Capture recording commands already resolve the durable capture session on the server, but authenticated `POST /v1/automations/:automationId/capture` still forwarded the internal `captureSessionId` returned by `CaptureSessionStarter`. The normal Next.js flow does not need that identifier: it uses only the short-lived signed Live View URL and expiry. Returning the durable session identity widened the public control-plane surface without product value and was inconsistent with the existing server-owned Start/Finish/Cancel recording boundary.

### Change

- The authenticated Capture-start HTTP response now returns only:
  - `kind: "READY"`;
  - the bounded signed `liveViewUrl` capability needed for the existing no-store handoff;
  - `expiresAt`.
- The internal provider-neutral `CaptureSessionStarter` contract is unchanged. It may still return `captureSessionId` to the server so durable capture registration, collector control, completion, cancellation, and idempotency continue to use the existing authority.
- Added a direct HTTP regression proving the starter can return a durable capture-session ID while the authenticated response contains neither that value nor a `captureSessionId` property.
- Existing `NOT_CONFIGURED` behavior and zero-AgentCore-allocation gating are unchanged.

## Security / tenancy review

- Tenant/user ownership is still resolved before capture startup through the authenticated control-plane scope and the existing automation lookup.
- The durable capture-session ID, Browser session ID, Browser Profile reference, trace identity and recording-control state remain server-side.
- The Live View URL remains intentionally user-visible capability material because the owner must interact with the isolated capture browser. Existing Next.js handoff protections (`no-store`, no-referrer, bounded HTTPS URL, no embedded credentials, separate-tab flow) remain unchanged.
- This slice does not broaden CAPTCHA/MFA handling or bypass third-party security controls.

## Idempotency / concurrency / retry / timeout

- No capture claim, DynamoDB conditional write, collector launch, Browser session retry, timeout, or duplicate-capture behavior changed.
- The existing current-capture pointer remains the durable concurrency authority. Sequential duplicate capture starts are rejected before Browser allocation; simultaneous races can allocate a temporary losing session which is cleaned up after durable contention classification.
- Hiding the session identity from HTTP cannot create a new execution path because subsequent recording commands already server-resolve the active capture.

## Side-effect verification / recovery

- Capture completion ordering remains Browser Profile save -> immutable trace persistence -> durable capture completion -> ephemeral browser stop.
- Workflow compilation, expected-effect capture verification, Fresh Test, scheduled execution, side-effect verification, human takeover/resume, leases, heartbeat, and reconciliation are unchanged.
- No recovery authority is derived from the Capture-start response.

## Cost / observability

- No additional DynamoDB, S3, AgentCore Browser, AgentCore Runtime, OpenAI, Scheduler, SQS, Step Functions, SES or CloudWatch call is introduced.
- The public payload is smaller and contains less implementation identity.
- No dependency, IAM permission, AWS resource, GitHub Actions artifact, table/index, or persistence schema changed.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new capture-start HTTP redaction regression.

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
- The internal `CaptureStartResult` service type still includes the durable session identity because AWS capture composition needs it. Transport adapters must continue treating that field as server-only and must not re-expose it.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. Cognito/Google sign-in;
4. configure OpenAI BYOK;
5. AgentCore Live View capture and trusted completion, verifying the browser never receives a durable capture-session identifier;
6. compile and inspect the semantic plan;
7. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
8. inspect the ordered execution timeline, bounded semantic decisions, and authenticated evidence;
9. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
10. verify run history, SES notification and CloudWatch telemetry;
11. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
