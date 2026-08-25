# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `66586c171bf37f36848909f40d37f55acbeca645` (`Add user-facing run execution timeline`).
- GitHub Actions CI #315 completed successfully on that exact `main` SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics/evidence/timeline, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — bounded semantic reasoning summaries

### Product gap

`END_GOAL.md` calls for reasoning summaries in the detailed run record. The OpenAI BYOK reasoning adapter already returns a short structured decision, but the execution engine discarded all reasoning metadata after the semantic browser action was chosen. Users could see that a workflow progressed or failed, but not whether a constrained semantic fallback was used or which allowed action it selected.

The provider response also contains a free-form `summary`. Persisting or exposing that string would be the wrong product boundary: it can repeat untrusted page context or user inputs and must not become a surrogate chain-of-thought surface.

### Change

- Added a provider-neutral `RunReasoningSummary` durable checkpoint record containing only:
  - internal node identity for server-side correlation;
  - trigger (`WORKFLOW_REASONING` or `SEMANTIC_RECOVERY`);
  - accepted allowed action;
  - bounded confidence value.
- `WorkflowExecutionEngine` records a summary only after the structured reasoning decision passes the existing allowed-action/confidence validation. The provider's free-form `ReasoningDecision.summary`, arguments, page context and inputs are deliberately not copied into this durable summary.
- Semantic decisions are preserved across ordinary checkpoints and the existing already-applied human-resume reconstruction boundary.
- `RunDetailService` maps durable node identity to the existing synthetic semantic step ordinal and exposes only `{ step, trigger, action, confidence }` after validating count/action/confidence/trigger bounds.
- The authenticated run page now shows a **Semantic decisions** card distinguishing workflow reasoning from semantic recovery and displaying the accepted action/confidence.
- Added regressions proving a deliberately secret-bearing provider summary/arguments are absent from both durable reasoning summaries and the authenticated run view, plus fail-closed handling of malformed durable reasoning metadata.

## Security / tenancy review

- Reasoning summaries stay within the existing tenant/user-scoped checkpoint and authenticated run-detail boundary.
- Internal node IDs are never returned to the browser; they are translated to semantic step ordinals using the immutable workflow version.
- Provider free-form rationale, browser/page context, input values, selectors, model arguments, raw errors, evidence references, Browser Profile/session data, BYOK material, workload tokens and chain-of-thought remain excluded.
- This slice does not ask the model for additional explanation and therefore introduces no new prompt-injection surface or model disclosure channel.
- Cross-tenant isolation remains enforced before run/checkpoint/workflow access.

## Idempotency / concurrency / retry / timeout

- No new model call, browser action, retry layer, queue message, lock or lease is introduced.
- A reasoning summary is appended only for an accepted semantic decision that the engine is about to execute. Retries can therefore produce multiple ordered summaries for repeated reasoning attempts, matching the durable execution history rather than inventing deduplication.
- Existing checkpoint persistence remains the durability authority. Concurrent/stale run views are refreshed through the existing bounded active-run polling.
- Existing reasoning/provider and browser operation timeouts are unchanged.

## Side-effect verification / recovery

- Allowed-action validation and side-effect verification remain authoritative; the summary is observational and cannot authorize execution, retry, branching or human resume.
- Failed semantic browser execution can still retain the accepted decision summary so the owner can see what was attempted, while the run/checkpoint failure remains the execution authority.
- Existing human-resume reconstruction preserves prior reasoning summaries but receives no additional execution permission from them.

## Cost / observability

- No additional OpenAI, AgentCore Browser, AgentCore Runtime, DynamoDB read, S3, Scheduler, SQS, Step Functions, SES or CloudWatch call is introduced.
- Checkpoint items gain a small bounded structured record only when semantic reasoning is actually used. The execution engine already caps workflow node executions at 1,000; the run-detail boundary rejects more than 1,000 reasoning records.
- No dependency, IAM permission, AWS resource, GitHub Actions artifact or table/index change was added.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new reasoning-summary regressions.

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

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. Cognito/Google sign-in;
4. configure OpenAI BYOK;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect the semantic plan;
7. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
8. inspect the ordered execution timeline, bounded semantic decisions, and authenticated evidence;
9. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
10. verify run history, SES notification and CloudWatch telemetry;
11. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
