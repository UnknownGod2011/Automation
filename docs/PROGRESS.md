# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `b92b5edbb1b598e8d395e12fbde023b786a944f4` (`Add authenticated run evidence viewer`).
- GitHub Actions CI #313 completed successfully on that exact `main` SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — user-facing execution timeline

### Product gap

`END_GOAL.md` calls for a detailed run timeline. Run diagnostics already exposed the current semantic step, completed semantic steps, failure classification, checkpoint counters, and authenticated evidence previews, but they did not assemble those safe facts into one ordered execution timeline. A user therefore had to infer what the run had done by comparing separate cards.

### Change

- Added a web-only `buildRunTimeline()` presentation helper over the existing sanitized `RunSemanticProgressView`.
- The run page now renders an ordered timeline from durable semantic progress:
  - completed steps are labelled `Completed`;
  - the current step is labelled `Current`;
  - when a semantic failure exists it replaces the current marker with `Failed / needs attention`.
- Repeated semantic step ordinals are deliberately retained so loop/revisit progress is not silently deduplicated or invented.
- If immutable workflow metadata is temporarily unavailable, the timeline fails soft while durable status/checkpoint/failure diagnostics remain visible.
- Added regression coverage for completed/current ordering, failure precedence, repeated-step preservation, and unavailable semantic metadata.

## Security / tenancy review

- The timeline consumes only the already-authenticated, tenant-scoped `RunDetailView`; it adds no new endpoint or authority.
- It contains only synthetic step ordinal, node kind, bounded objective text, and presentation state.
- Internal workflow/node IDs, selectors, input/output bindings, runtime variables, verification expected values, evidence references, Browser Profile/session data, BYOK material, workload tokens, raw provider/browser errors, and model chain-of-thought remain excluded.
- Cross-tenant isolation continues to be enforced by `RunDetailService` before any semantic workflow data is returned.

## Idempotency / concurrency / retry / timeout

- This slice is read-only presentation logic. It creates no run, checkpoint, lock, lease, retry, queue message, browser action, model request, or schedule mutation.
- The page uses one authenticated run-detail snapshot. Concurrent execution can advance after that snapshot; the existing bounded run-status polling refreshes active runs and remains the freshness mechanism.
- Timeline construction preserves the durable completed-step sequence supplied by the checkpoint instead of reordering it by graph topology.

## Side-effect verification / recovery

- Browser side-effect verification, deterministic-first execution, semantic fallback, and human-resume/takeover authority are unchanged.
- A failed/attention timeline marker is presentation only and never authorizes retry or resume.
- Existing Runtime validation and durable recovery claims remain authoritative for any continuation.

## Cost / observability

- No additional DynamoDB, S3, AgentCore Browser, AgentCore Runtime, OpenAI, Scheduler, SQS, Step Functions, SES, or CloudWatch call is introduced.
- No dependency, IAM permission, AWS resource, GitHub Actions artifact, or persistence schema changed.
- The timeline reuses the same run-detail response already required to render diagnostics.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new timeline regressions.

Do not claim this slice green until GitHub Actions completes successfully on the exact published head.

## Known production risks / deliberately parked work

- The protected real AWS deployment/full vertical demonstration still has not been completed with real Environment/OIDC/VPC inputs.
- VPC AgentCore Browser route-table/DNS/security-group/firewall containment still requires live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Cognito/Google federation, SES delivery and AgentCore Runtime/Browser behavior are structurally tested but still need live-service validation.
- OpenAI is the only concrete production BYOK reasoning adapter today; the core remains provider-neutral for later adapters.
- DynamoDB and EventBridge Scheduler mutations remain separate fail-closed systems rather than one transaction; live operation must validate reconciliation expectations.
- Automation settings still use ordinary repository read/modify/write semantics; broad CAS machinery remains parked unless live concurrency shows material loss.
- Evidence screenshots are intentionally owner-visible and may contain ordinary page data. Evidence retention/deletion policy should be revisited after live usage establishes operational needs.
- The timeline intentionally does not expose model chain-of-thought. If future product research needs model-level explanations, add only bounded structured decision summaries, never private reasoning traces.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. Cognito/Google sign-in;
4. configure OpenAI BYOK;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect the semantic plan;
7. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
8. inspect the ordered execution timeline and authenticated evidence;
9. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
10. verify run history, SES notification and CloudWatch telemetry;
11. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
