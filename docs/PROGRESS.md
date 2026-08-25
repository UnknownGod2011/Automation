# Production progress

Updated: 2026-08-25

## Current baseline

- `main` is `1037639f86e67617fb4a330679f1d6567d8dfb58` (`Retain bounded capture action screenshots`).
- PR #17 was exact-head green on CI #325 before squash merge.
- Push CI #326 on the squash SHA stopped exclusively at deterministic pnpm lock verification before install/type-check/package/tests because pnpm 10.15.0 re-resolved the transitive graph from reviewed snapshot `93779e00f81343c50d61d1389227b3dc5fa39677b79900db4df9abc35ff0bff4` to `30304f64b0d6d8e064117861339266bdbb30cddb7eceb36d3d007c2c9867052f`.
- No package manifest changed in the merge, and the existing AWS SDK/DynamoDB peer-alignment assertions remain required.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline/reasoning summaries, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This corrective slice — authenticate post-merge pnpm lock drift

### Root cause

The squash merge did not change dependency manifests, but the repository intentionally regenerates its pnpm 10.15.0 lock graph from manifests on every CI run. Upstream transitive resolution moved after CI #325, so the fail-closed lock fingerprint correctly rejected the new graph on push CI #326.

### Change

- Update `scripts/materialize-pnpm-lock.sh` to the exact authoritative CI #326 SHA-256: `30304f64b0d6d8e064117861339266bdbb30cddb7eceb36d3d007c2c9867052f`.
- Keep pnpm pinned to 10.15.0.
- Keep the reviewed AWS SDK peer assertions unchanged; do not suppress or bypass them.
- No runtime dependency, product code, IAM permission, AWS resource, retry path, browser/model behavior, or recovery authority changes in this corrective slice.

## Product slice already promoted — retained capture action screenshots

- The production AgentCore Playwright collector persists one bounded post-action PNG screenshot for captured `CLICK` and `SUBMIT` workflow events through the existing tenant-scoped `ArtifactStore`.
- Production composition reuses the encrypted S3 artifact store; no new bucket, dependency, IAM capability, or storage system was introduced.
- Screenshot bytes are capped at 2 MiB. Screenshot/storage failure is supplementary and cannot manufacture or weaken structural effect verification.
- `INPUT` events remain screenshot-free so just-entered runtime values cannot enter capture screenshot evidence through this feature.
- Authentication setup remains outside capture collection because collection starts only after the durable `AUTH_SETUP -> WORKFLOW` transition.

## Security / tenancy review

- Lock-snapshot review changes only build reproducibility metadata; it introduces no application authority.
- Existing tenant/user scoping for capture artifacts remains unchanged.
- Capture screenshots stay server-side and use opaque artifact references; Browser Profile/session identity, credentials, workload tokens, and raw S3 keys remain outside authenticated responses.
- `INPUT` screenshot suppression remains the privacy boundary for typed workflow values.

## Idempotency / concurrency / retry / timeout

- No runtime idempotency, lock, lease, retry, timeout, queue, or schedule behavior changes in this corrective slice.
- Capture screenshot evidence remains supplementary and has no retry authority.
- Existing capture claim/expiry/completion/cancellation semantics are unchanged.

## Side-effect verification / user recovery

- Structural post-action verification remains authoritative for capture compilation and execution.
- Screenshot presence cannot make an unverifiable action compile.
- Fresh Test, scheduled execution, bounded retries, target-auth takeover/resume, heartbeat fencing, and reconciliation are unchanged.

## Cost / observability

- The corrective lock update adds zero cloud/runtime cost.
- The promoted capture feature adds at most one bounded S3 object per captured CLICK/SUBMIT event when screenshot capture succeeds.
- No additional AgentCore Browser/Runtime, OpenAI, DynamoDB, Scheduler, SQS, Step Functions, SES, or CloudWatch work is introduced beyond the existing capture session and screenshot S3 put.

## Validation

The corrective commit is complete only after GitHub Actions passes on its exact head:

1. deterministic pnpm lock verification using `30304f64b0d6d8e064117861339266bdbb30cddb7eceb36d3d007c2c9867052f`;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite.

Do not claim the corrective head green until the exact-head Actions run completes successfully.

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

After restoring exact-head green CI, run the protected real AWS vertical demonstration rather than deepening recovery internals:

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
