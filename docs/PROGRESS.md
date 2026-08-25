# Production Progress

Updated: 2026-08-25

## Current baseline

- Incoming `main`: `18f9b85e117b7f314f62a9fe06f93fd6e9b4fd47` (`Refresh post-merge pnpm lock snapshot`).
- GitHub Actions CI #328 completed successfully on that exact SHA: deterministic lock verification, frozen install, strict checks/builds, production packaging, AWS deployment/security contracts, and the full test suite were green.
- The AWS-first vertical is structurally present: Cognito/Google auth, Next.js control plane, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, side-effect verification, sanitized history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation depth is intentionally parked unless CI or the real vertical exposes a correctness blocker.

## This slice — review retained capture evidence before Fresh Test

### Product gap

The production Playwright capture collector now retains bounded post-action PNG screenshots for meaningful `CLICK`/`SUBMIT` workflow actions, but those artifacts were server-only. The user could review the compiled semantic plan and later run evidence, yet could not inspect the capture screenshots before spending a cloud Fresh Test or deciding to reteach the workflow.

### Change

- Add a provider-neutral, authenticated `CaptureEvidenceService` over the latest **durably completed** capture for an automation.
- Add read-only routes:
  - `GET /v1/automations/:automationId/capture-evidence`
  - `GET /v1/automations/:automationId/capture-evidence/:ordinal`
- The browser chooses only a bounded 1-based screenshot ordinal. The control plane resolves the authoritative completed capture, immutable trace, and opaque artifact reference server-side.
- Only `WORKFLOW` `CLICK`/`SUBMIT` PNG screenshots are reviewable. `AUTH_SETUP` and `INPUT` screenshot artifacts are excluded even if an older/corrupted trace contains them.
- Index responses expose only action kind, occurrence time, safe URL origin, ordinal, and bounded counts. Query strings, URL fragments, trace IDs, artifact refs, Browser Profile refs, and browser-session IDs remain server-side.
- PNG previews are capped at 2 MiB and signature-validated. Oversized or unsupported evidence returns a protected placeholder instead of raw bytes.
- The semantic workflow-inspection card links to the capture-evidence review. Screenshot bytes are fetched only when the owner explicitly opens an evidence item; ordinary automation-detail reads do not add S3 artifact reads.
- Production AWS composition reuses the existing tenant-scoped encrypted `AwsS3ArtifactStore`, completed-capture DynamoDB authority, and immutable capture repository. No new AWS resource, dependency, or IAM permission is introduced.

## Security / tenant isolation

- Automation ownership is resolved before completion/trace/artifact access. Cross-tenant requests fail as `NOT_FOUND` before S3 reads.
- The latest completed capture pointer is the authority; clients cannot select trace IDs, capture-session IDs, browser-session IDs, profile refs, or S3 references.
- Trace ownership, automation identity, trace ID, Browser Profile identity, and capture completion state are revalidated before any artifact read.
- Authentication-setup screenshots are excluded from this user-review surface.
- Typed-input events are excluded because values entered during workflow teaching can be visible immediately after typing; the existing capture path also suppresses new INPUT screenshots.
- Full URL path/query/fragment is not returned; only a validated HTTP(S) origin may be displayed.
- Screenshots can still contain ordinary page data visible during the demonstration. Access therefore remains owner-authenticated, bounded, no-store through the existing web client, and server-resolved.

## Idempotency / concurrency / retry / timeout

- Evidence review is read-only and grants no execution or capture authority.
- The durable completed-capture pointer selects one authoritative latest capture. Concurrent or stale capture completion semantics remain unchanged.
- No retry loop is added. Completion/trace/artifact storage uncertainty returns a sanitized conflict and never triggers another browser action.
- Ordinals are presentation selectors only and cannot mutate capture state or choose storage identity.

## Side-effect verification / user recovery

- Capture screenshots remain **supplementary teaching evidence**. Structural expected-effect verification is still the compiler/execution authority; screenshot presence cannot make an unverifiable side effect compile or succeed.
- Fresh Test, scheduled execution, bounded retries, target-auth takeover/resume, heartbeat fencing, and reconciliation are unchanged.
- The review page gives users a cheaper correction point: inspect capture evidence and semantic plan before deciding whether to spend a Fresh Test or recapture.

## Cost / observability

- Capture collection cost is unchanged from the already-promoted screenshot-retention feature.
- Opening the capture-evidence index performs the existing owner-scoped automation/completion/immutable-trace reads but no screenshot S3 GET.
- Opening one screenshot adds one bounded S3 GET and returns at most 2 MiB before base64 overhead.
- Automation detail, dashboard, Fresh Test polling, Scheduler, AgentCore Runtime/Browser, OpenAI, SES, and CloudWatch request counts are unchanged.

## Regression coverage

- Latest completed capture lists only workflow CLICK/SUBMIT screenshots.
- INPUT and AUTH_SETUP screenshot artifacts are excluded.
- Artifact/trace/browser-session identity never appears in the capture-evidence index.
- URL query/fragment data is reduced to safe origin.
- Bounded PNG preview works by ordinal without exposing artifact refs.
- Cross-tenant access stops before artifact storage.
- Missing completed capture returns `NONE`; a completed pointer with a missing/corrupt immutable trace fails closed.
- Capture-evidence HTTP routes are GET-only and delegate unrelated routes.
- The authenticated Next.js client encodes automation IDs, preserves request-scoped auth, and rejects invalid ordinals before network I/O.

## Validation

The slice is green only after GitHub Actions succeeds on the exact published head. Required gates remain:

1. deterministic pnpm lock verification with pnpm 10.15.0 and the reviewed lock fingerprint;
2. frozen installation;
3. `pnpm check`, including strict TypeScript and Next.js production build/type validation;
4. AgentCore Runtime, control-plane Lambda, and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract checks;
6. full test suite including the new capture-evidence regressions.

Never weaken these checks to obtain green status.

## Known production risks / deliberately parked work

- The real AWS environment still has not demonstrated the complete vertical with real Cognito/Google, SES, AgentCore Browser/Runtime, Scheduler/SQS/Step Functions, and OpenAI BYOK.
- VPC Browser mode is provisioned and verified, but real route-table/DNS/security-group/NACL/firewall policy still needs live proof against private/link-local/control-plane destinations after resolution and redirects.
- Capture and run screenshots can contain owner-visible page content; retention/deletion policy should be measured and made explicit before broad production use.
- DynamoDB ↔ EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI is currently the concrete production BYOK reasoning provider; provider-neutral core support remains broader than the deployed web provider set.
- Additional crash-recovery micro-hardening remains parked unless the live vertical or CI reveals a real defect.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser subnet/security-group inputs;
2. require live public/auth smoke to pass and all five System capabilities to report `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. create an automation and start AgentCore Live View capture;
5. authenticate inside Live View, record the workflow, finish trusted completion, and review the retained capture screenshots;
6. compile and inspect the semantic workflow;
7. run a Fresh Test that lasts more than 30 seconds and confirm asynchronous durable result following;
8. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
9. confirm EventBridge Scheduler → SQS → Step Functions → AgentCore Runtime executes and verifies the workflow while the user device is off;
10. inspect timeline, bounded reasoning summaries, authenticated run evidence, history, SES notification, and CloudWatch telemetry;
11. deliberately expire target authentication, open the secure repair Live View, save the repaired Browser Profile, resume once, and confirm the terminal outcome/reporting;
12. prioritize defects exposed by that real environment over speculative recovery hardening.
