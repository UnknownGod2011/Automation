# Production Progress

Updated: 2026-08-27

## Current baseline

- `main` is `bbdaeaca1657e05b4bfcc825403366ea9259018d` (`Add guided Fresh Test runtime inputs`), promoted from exact-head-green PR #36 / CI #366.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub still reports `main` as unprotected. The deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — guided reusable scheduled inputs

### Product gap

Fresh Test now uses guided ordinal fields so users do not need to know synthetic `capture_input_N` workflow-variable names. The long-lived Scheduled Inputs settings surface still exposed those internal keys and required hand-authored replacement JSON. That was unnecessary implementation leakage and created a weaker browser-to-server boundary than the newer Fresh Test flow.

### Change

- Added a guided scheduled-input parser whose browser-visible fields are opaque ordinals (`scheduledInput-1`, `scheduledInput-2`, ...).
- The server reloads immutable workflow inspection for the automation and maps those ordinals to the exact trusted unresolved `capture_input_N` requirement order.
- The Scheduled Inputs settings page now renders one semantic-step field per reusable value and no longer renders internal workflow-variable names or JSON templates.
- Existing scheduled values remain write-only and are never returned to the browser.
- The legacy JSON parser remains only for the current initial Publish form; this slice deliberately narrows the long-lived settings surface without changing publish semantics in the same CI batch.

## Security / tenant isolation

- Tenant/user authority remains authenticated server state.
- Ordinal field names carry no workflow authority. Missing, duplicate, forged, mixed JSON+guided, malformed, oversized, or unacknowledged submissions fail before the control-plane mutation.
- Guided values are limited to the trusted capture-generated requirement set. Arbitrary application/workflow variable names cannot be introduced through the settings form.
- Passwords, OTPs, API keys, tokens, and target-site authentication remain outside this ordinary persistence boundary; target authentication belongs in Browser Profile state and provider keys remain in AgentCore Identity.

## Idempotency / concurrency / retry / timeout

- No new run identity, queue, retry loop, lease, or persistence authority is introduced.
- Scheduled-input replacement continues to use the existing provider-neutral lifecycle and automation repository. Exact same values remain idempotent there.
- The mutation reloads the current immutable workflow requirements before parsing, so a stale page cannot bind ordinal values against a changed workflow requirement set.
- Existing limits remain at most 64 values, 4,096 characters per value, and 32,768 characters total.

## Side-effect verification / user recovery

- No browser action, reasoning, or verifier behavior changes. Scheduled runs still use the same immutable workflow and explicit per-node verification contracts.
- Invalid guided values are rejected before future execution configuration is mutated. Existing scheduled values remain preserved on a rejected request.

## Cost / observability

- The settings mutation adds one existing workflow-inspection read before replacement and no Browser/AgentCore allocation, model request, Scheduler delivery, AWS resource, IAM permission, dependency, or retained Actions artifact.
- No new metric dimension or secret-bearing log field is introduced.

## Regression coverage

- Tests prove ordinal fields map exactly to trusted workflow requirement order.
- Forged, missing, duplicate, mixed JSON+guided, unacknowledged, malformed requirement, and oversized values fail closed.
- The existing legacy publish JSON parser remains covered for compatibility.
- Next.js production packaging remains the integration gate for the guided settings page and route mutation.

## Validation

- This slice is complete only after GitHub Actions succeeds on the exact batched head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened to obtain green CI. A deterministic lock mismatch, if one occurs, requires inspection of the authoritative CI-produced graph before the single permitted corrective commit.

## Known production risks / parked work

- `main` still needs actual GitHub branch/ruleset protection before the deployment workflow will issue AWS credentials.
- The controlled first-party AWS vertical has not yet been demonstrated end to end against live Cognito/Google, AgentCore Browser/Runtime, EventBridge/SQS/Step Functions, SES, and actual VPC network policy.
- The initial Publish form still uses the legacy bounded scheduled-input JSON representation. A later product slice can move Publish to the same guided ordinal UX after this settings boundary is proven.
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
5. Compile, inspect the semantic plan, and use guided Fresh Test values;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and any required explicitly non-secret scheduled inputs;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. update reusable scheduled values through the new guided settings surface and verify only future admissions receive the replacement;
10. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete the secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
