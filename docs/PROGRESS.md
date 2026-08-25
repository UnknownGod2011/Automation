# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `75160d3caa962d6661263d85f4ae2ca124b2e203` (`Align Capture-start web contract with public API`).
- GitHub Actions CI #322 completed successfully on that exact SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline/reasoning summaries, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — expose production deployment readiness in the authenticated product

### Product gap

The control plane already reports explicit capability states for authentication, cloud capture, cloud execution, scheduling, and notifications. Before this slice, users/operators had no single authenticated product surface showing whether those capabilities were actually production-configured. During the first real AWS deployment that makes it unnecessarily hard to distinguish an intentionally `NOT_CONFIGURED` subsystem from a healthy end-to-end path.

### Change

- Added a provider-neutral web presentation helper that maps the existing control-plane capability contract into one ordered production-readiness view.
- Production readiness is strict: every capability must be `CONFIGURED`. `LOCAL_MOCK` is useful for development but never counts as production-ready.
- Added `/settings/status`, an authenticated read-only Next.js page showing Authentication, Cloud capture, Cloud execution, Scheduling, and Notifications state.
- Added a persistent authenticated `System` navigation link. It remains available even when the mutation-oriented control-plane navigation collapses, so an authenticated user can inspect why the product is unavailable.
- The page makes clear that it is read-only and does not allocate Browser/Runtime compute, invoke a model, create a schedule, or mutate automation state.
- Added regression coverage for all-configured readiness, `LOCAL_MOCK` rejection, explicit `NOT_CONFIGURED` capability reporting, and deterministic capability ordering.

## Security / tenancy review

- The status page uses the existing authenticated control-plane dashboard read; it introduces no new API authority.
- Capability state is deployment metadata only. Tenant/user ownership, Browser Profile references, capture/session identities, BYOK secret references, workload tokens, provider errors, and run evidence remain server-side.
- Signed-out users are redirected to the existing Cognito/Google-or-email sign-in boundary before capability inspection.
- A missing/unsafe control-plane endpoint fails closed as unavailable rather than fabricating readiness.

## Idempotency / concurrency / retry / timeout

- This slice is read-only and creates no idempotency key, lock, lease, retry loop, queue message, browser action, model request, schedule mutation, or persistence write.
- The capability view reflects one authenticated dashboard snapshot. Runtime execution still independently revalidates Capture/Fresh-Test/Scheduling configuration at their existing authoritative boundaries.
- No cross-system transactional behavior changed.

## Side-effect verification / user recovery

- Workflow action verification, capture completion ordering, Fresh Test, scheduled execution, retries, target-auth takeover/resume, heartbeat fencing, and reconciliation are unchanged.
- The page does not grant recovery or execution authority; it only explains deployment readiness before the user starts the product flow.

## Cost / observability

- Visiting the page performs the same bounded authenticated dashboard read already used by the product. It adds no AgentCore Browser/Runtime, OpenAI, EventBridge Scheduler, SQS, Step Functions, SES, or S3 work.
- No dependency, IAM permission, AWS resource, table/index, persistence schema, GitHub Actions artifact, or retained storage is added.
- The page is intended to reduce failed live-demo attempts by making deployment configuration gaps visible before cloud execution is requested.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new deployment-readiness regression coverage.

Do not claim this slice green until GitHub Actions completes successfully on the exact published head.

## Known production risks / deliberately parked work

- The protected real AWS deployment/full vertical demonstration still has not been completed with real Environment/OIDC/VPC inputs.
- VPC AgentCore Browser route-table/DNS/security-group/firewall containment still requires live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Cognito/Google federation, SES delivery and AgentCore Runtime/Browser behavior are structurally tested but still need live-service validation.
- OpenAI is the only concrete production BYOK reasoning adapter today; the core remains provider-neutral for later adapters.
- DynamoDB and EventBridge Scheduler mutations remain separate fail-closed systems rather than one transaction; live operation must validate reconciliation expectations.
- Automation settings still use ordinary repository read/modify/write semantics; broad CAS machinery remains parked unless live concurrency shows material loss.
- Evidence screenshots are intentionally owner-visible and may contain ordinary page data. Evidence retention/deletion policy should be revisited after live usage establishes operational needs.
- The System page reports declared deployment capability state; it does not replace live smoke tests or prove external-service health.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. open `/settings/status` and require all five production capabilities to report `CONFIGURED` before beginning the demo;
4. Cognito/Google sign-in;
5. configure OpenAI BYOK;
6. AgentCore Live View capture and trusted completion;
7. compile and inspect the semantic plan;
8. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
9. inspect the ordered execution timeline, bounded semantic decisions, and authenticated evidence;
10. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
11. verify run history, SES notification and CloudWatch telemetry;
12. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
