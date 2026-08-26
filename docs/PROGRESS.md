# Production Progress

Updated: 2026-08-27

## Current baseline

- `main` is `d4c34c42829a4aa184e7896de75196305e43c24e` (`Guide reusable scheduled input settings`) and is independently green on push CI #369.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — guided Fresh Test and initial Publish values

### Product gap

The product already had guided Fresh Test and post-publish Scheduled Inputs surfaces, but the main automation detail page still exposed legacy JSON editors containing internal `capture_input_N` workflow-variable names. Initial Publish also accepted that legacy JSON representation directly. This was an unnecessary implementation leak and made the first publish path weaker than the long-lived Scheduled Inputs settings boundary.

### Change

- The automation detail page now routes Fresh Test through the dedicated guided per-step form instead of embedding a JSON textarea with internal workflow-variable names.
- Initial Publish now renders one reusable scheduled value per semantic workflow step using opaque ordinal field names (`scheduledInput-1`, `scheduledInput-2`, ...).
- Added `parseScheduledPublishInputForm()`, which reloads the immutable workflow requirement set server-side and maps those ordinals to the exact trusted `capture_input_N` keys.
- Publish with no unresolved captured values requires no acknowledgement or runtime-value payload.
- Legacy `scheduledNonSecretInputs` JSON is rejected by the primary Publish boundary rather than treated as browser authority.
- The existing legacy JSON parser remains available only for compatibility with non-primary callers; the user-facing Fresh Test, initial Publish, and post-publish Scheduled Inputs paths no longer need internal workflow-variable names.

## Security / tenant isolation

- Tenant/user authority remains authenticated server state.
- Browser-visible ordinal names carry no workflow authority. The server reloads immutable workflow inspection before Publish and performs the only ordinal -> workflow-variable mapping.
- Missing, duplicate, forged, mixed legacy+guided, malformed, oversized, or unacknowledged scheduled values fail before the publish mutation.
- Fresh Test and Publish no longer render `capture_input_N` names on the main product page.
- Passwords, OTPs, API keys, tokens, and target-site authentication remain outside ordinary runtime/scheduled-input persistence; target authentication belongs in Browser Profile state and provider keys remain in AgentCore Identity.

## Idempotency / concurrency / retry / timeout

- No new run identity, queue, retry loop, lease, or persistence authority is introduced.
- Publish still validates the human-facing schedule first, then reloads trusted workflow + automation + run provenance before mutation.
- The lifecycle remains the final authority that only the latest successfully Fresh-Tested immutable workflow may publish.
- A stale page cannot bind ordinal values against a different workflow requirement set because the POST route reloads current immutable workflow inspection before parsing.
- Existing scheduled-input limits remain at most 64 values, 4,096 characters per value, and 32,768 characters total.

## Side-effect verification / user recovery

- No browser action, reasoning, retry, verifier, Scheduler, or human-recovery behavior changes.
- Scheduled execution continues to use the same immutable workflow and explicit per-node verification contracts.
- Invalid guided values are rejected before EventBridge Scheduler activation or automation configuration mutation.

## Cost / observability

- Initial Publish adds one trusted workflow-inspection read in the POST path; no Browser/AgentCore allocation, model request, Scheduler delivery, AWS resource, IAM permission, dependency, or retained Actions artifact is added.
- Fresh Test keeps the existing execution cost; this slice only moves user input collection to the already-existing guided page.
- No new metric dimension or secret-bearing log field is introduced.

## Regression coverage

- Scheduled-input tests prove initial Publish maps opaque ordinals to the immutable trusted requirement order.
- Publish with no unresolved inputs succeeds without a scheduled-input acknowledgement.
- Legacy JSON, forged ordinals, malformed trusted requirements, missing values, duplicate values, and mixed guided/legacy submissions fail closed.
- Existing guided Scheduled Inputs regression coverage remains intact.
- Next.js production packaging remains the integration gate for the main automation page and guided Fresh Test route.

## Validation

- This slice is complete only after GitHub Actions succeeds on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch, if one occurs, requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- Checkbox, radio, file-upload, password, miscellaneous controls, and multi-select remain intentionally unsupported until they receive explicit provider-neutral semantics and verification. Single-select remains supported through deterministic SELECT.
- SELECT semantic recovery remains intentionally disabled because the bound option may be private per-run data; deterministic retry + human escalation is the current safe boundary.
- VPC Browser route-table/DNS/security-group/firewall policy still requires live validation against private/link-local/control-plane destinations and redirects.
- DynamoDB <-> EventBridge Scheduler mutations remain fail-closed but are not cross-service transactional.
- OpenAI remains the concrete production BYOK reasoning provider; Google remains a later adapter.
- Capture/run screenshots can contain owner-visible page content; production retention/deletion policy remains a live operational concern.
- Additional crash-recovery micro-hardening remains parked unless live execution or CI reveals a real defect.

## Next product milestone

After exact-head green CI, promote this slice, configure required GitHub `main` protection, then run the controlled real AWS vertical:

1. deploy an immutable release with `DemoTargetEnabled=true`, bounded demo session TTL, and real VPC Browser network inputs;
2. require strengthened live smoke and all five System capabilities `CONFIGURED`;
3. sign in through Cognito/Google and configure one OpenAI BYOK credential;
4. target `${webOrigin}/demo-target`, authenticate in Live View, record the supported SELECT + TYPE + SUBMIT workflow, finish trusted completion, and inspect capture evidence;
5. Compile, inspect the semantic plan, and use the guided Fresh Test values;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and guided explicitly non-secret reusable scheduled values;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. update reusable scheduled values through the guided settings surface and verify only future admissions receive the replacement;
10. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete the secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
