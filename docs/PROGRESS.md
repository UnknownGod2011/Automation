# Production progress

Updated: 2026-08-25

## Current baseline

- Incoming `main`: `3510f61ffeccf95ce4b3a8373637962eb38d91d7` (`Add production deployment readiness status`).
- GitHub Actions CI #324 completed successfully on that exact SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline/reasoning summaries, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — retain bounded post-action capture screenshots

### Product gap

The production AgentCore Playwright collector already records navigation/click/input/submit events plus redacted structural verification, but every captured event had `artifactRefs: []`. That left the end-goal promise to retain screenshots around meaningful capture actions unimplemented in the real AWS capture path.

### Change

- The AWS capture collector can now use the existing tenant-scoped `ArtifactStore` to persist one post-action PNG screenshot for `CLICK` and `SUBMIT` workflow events.
- Production composition wires the existing encrypted S3 artifact store into the collector; no new bucket, dependency, IAM capability, or storage system is introduced.
- Screenshot bytes are capped at 2 MiB before persistence. Oversized, screenshot, or artifact-storage failures are treated as missing supplementary capture evidence and do not manufacture or weaken effect verification.
- `INPUT` capture events deliberately never take a screenshot. Typed values remain privacy-preserving `RUNTIME_VARIABLE` placeholders and cannot be copied into capture screenshots by this feature.
- Authentication setup remains outside collection because the long-running collector is attached only after the durable `AUTH_SETUP -> WORKFLOW` transition.

## Security / tenancy review

- Artifact writes reuse `AwsS3ArtifactStore`, which derives a tenant/user-scoped hashed S3 prefix and returns opaque artifact references.
- Capture screenshots are server-side trace evidence. No S3 key, Browser Profile reference, browser-session identity, provider credential, or workload token is added to the authenticated web/API response.
- `INPUT` remains screenshot-free because the page can contain the just-entered runtime value immediately after typing.
- CLICK/SUBMIT screenshots may contain ordinary owner-visible page content. They are therefore bounded and server-side; retention/deletion policy remains a live-production follow-up once real usage is measured.

## Idempotency / concurrency / retry / timeout

- Capture event identity remains one-based and stable within the capture session. Screenshot paths are derived from the server-owned capture session and event sequence under the already-scoped artifact prefix.
- No new retry loop is introduced. Screenshot/artifact uncertainty is fail-soft because these screenshots are supplementary authoring evidence rather than execution or verification authority.
- The existing structural post-action digest remains the compiler/execution verification contract; screenshot presence cannot make an unverifiable action compile.
- Concurrent capture authority, session expiry, finish/cancel semantics, Browser Profile save ordering, and trusted completion are unchanged.

## Cost / observability

- Cost increases by at most one bounded S3 object per captured CLICK/SUBMIT event when screenshot capture succeeds.
- INPUT and NAVIGATION events add no screenshot storage.
- No additional AgentCore Browser/Runtime, OpenAI, DynamoDB, Scheduler, SQS, Step Functions, SES, or CloudWatch request is introduced by the screenshot itself beyond the existing capture session and one S3 put per retained screenshot.
- Screenshot failures do not create retries or duplicate browser actions.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including capture regressions proving CLICK screenshot persistence, INPUT screenshot suppression, and supplementary-evidence failure behavior.

Do not claim this slice green until GitHub Actions completes successfully on the exact published head.

## Known production risks / deliberately parked work

- The protected real AWS deployment/full vertical demonstration still has not been completed with real Environment/OIDC/VPC inputs.
- VPC AgentCore Browser route-table/DNS/security-group/firewall containment still requires live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Cognito/Google federation, SES delivery and AgentCore Runtime/Browser behavior are structurally tested but still need live-service validation.
- OpenAI is the only concrete production BYOK reasoning adapter today; the core remains provider-neutral for later adapters.
- DynamoDB and EventBridge Scheduler mutations remain separate fail-closed systems rather than one transaction; live operation must validate reconciliation expectations.
- Automation settings still use ordinary repository read/modify/write semantics; broad CAS machinery remains parked unless live concurrency shows material loss.
- Capture and run screenshots can contain ordinary page data. Evidence retention/deletion policy should be revisited after live usage establishes operational needs.
- `main` currently reports as unprotected in GitHub branch metadata. The deployment workflow still validates exact `main` source before assuming the OIDC role, but repository branch/ruleset protection should be configured operationally before treating direct pushes as a protected promotion boundary.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass and all five System capabilities to report `CONFIGURED`;
3. Cognito/Google sign-in and OpenAI BYOK setup;
4. AgentCore Live View capture, including retained post-action screenshot evidence, and trusted completion;
5. compile and inspect the semantic plan;
6. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
7. inspect the ordered timeline, bounded semantic decisions, and authenticated run evidence;
8. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
9. verify run history, SES notification and CloudWatch telemetry;
10. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
