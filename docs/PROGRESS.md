# Production Progress

Updated: 2026-08-27

## Current baseline

- Incoming `main` is `7552d060e6d38ec5318dbae7e105f03d4f9723a4` (`Make unsupported capture controls actionable`).
- Push GitHub Actions CI #364 completed successfully on that exact SHA before this slice.
- The AWS-first product vertical is structurally present: Cognito/Google authentication, Next.js control plane, controlled first-party demo target, AgentCore Live View capture + Browser Profile persistence, immutable capture traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test, publish/scheduling, Scheduler -> SQS -> Step Functions -> AgentCore execution, OpenAI BYOK reasoning, explicit effect verification, sanitized timeline/reasoning/evidence/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Build reproducibility remains fail-closed through the reviewed pnpm lock fingerprint and frozen install. AWS SDK/DynamoDB peer-alignment assertions remain enabled.
- Recovery/crash-reconciliation depth remains intentionally parked unless CI or the real vertical exposes a correctness blocker.
- GitHub currently reports `main` as unprotected. The protected deployment workflow refuses AWS OIDC credentials unless the exact current `main` head is protected, so repository protection remains an operational prerequisite for the first live AWS deployment.

## This slice — guided Fresh Test runtime inputs

### Product gap

Privacy-preserving Capture intentionally replaces typed and selected values with unresolved `capture_input_N` bindings. Server-side Fresh Test validation already restricted submissions to that closed trusted set, but the primary product UX still asked users to hand-author JSON containing those synthetic internal keys. That is unnecessary implementation leakage and makes the Capture -> Compile -> Fresh Test path harder to use, especially once workflows contain multiple typed/select inputs.

### Change

- Added a guided owner-authenticated Fresh Test input page at `/automations/:automationId/fresh-test`.
- The page derives one field per unresolved input from the latest trusted workflow inspection and labels it by semantic step rather than asking the user to copy workflow-variable keys.
- Guided HTML fields use opaque ordinal names (`runtimeInput-1`, `runtimeInput-2`, ...). The server maps those ordinals back to the immutable trusted `capture_input_N` requirement order.
- `parseFreshTestRuntimeInputForm` now accepts either the existing bounded JSON representation or the guided ordinal representation, never both. Missing, duplicate, forged, mixed, oversized, or malformed fields fail closed before AgentCore execution.
- The semantic workflow card now links to the guided form and no longer teaches users to manually construct runtime JSON.
- The legacy JSON parser remains supported for the existing automation-detail form and trusted compatibility; the new guided path is additive and does not weaken its allowlist.

## Security / tenant isolation

- Tenant/user authority remains derived from authenticated server context. The browser cannot introduce a workflow variable by choosing a field name.
- Ordinal field names have no execution authority. They are mapped only against the ordered trusted runtime-input requirements loaded server-side from immutable workflow inspection.
- Raw values remain per-run material and may enter durable checkpoint state, so the UX explicitly rejects the idea that this is a secret-entry surface. Passwords, OTPs, API keys, and authentication tokens remain outside this path; target-site authentication belongs in the persisted Browser Profile.
- Capture values, selectors, workflow node IDs, Browser/Profile/session identifiers, BYOK references, workload tokens, and provider errors remain excluded from the guided page.

## Idempotency / concurrency / retry / timeout

- This change creates no new run identity, retry loop, queue, lease, or persistence authority. The existing server-owned Fresh Test run identity and execution-plane admission remain authoritative.
- The POST mutation reloads the latest trusted workflow requirements when parsing the submitted form. A stale guided page whose workflow changed therefore fails closed instead of binding values to a new variable set.
- Existing value limits remain unchanged: at most 64 capture inputs, 4,096 characters per value, and 32,768 characters total.

## Side-effect verification / user recovery

- No browser action or verifier behavior changes. Deterministic TYPE/SELECT execution and their existing explicit verification contracts remain mandatory.
- A malformed/stale guided submission is rejected before AgentCore Browser/model work. The user can return to workflow review and resubmit against the current compiled version.
- Unsupported checkbox/radio/file/password/other controls remain fail-closed at Compile and keep their dedicated correction UX.

## Cost / observability

- The guided page uses the same authenticated automation/workflow reads already used by the automation detail experience and adds no AWS resource, IAM permission, dependency, AgentCore allocation, OpenAI call, Scheduler delivery, or retained GitHub Actions artifact.
- Invalid input is rejected before Fresh Test cloud execution, avoiding avoidable Browser/model spend.
- No new metric dimension or secret-bearing log field is introduced.

## Regression coverage

- Web tests prove guided ordinal fields map exactly to the trusted capture-input keys.
- Missing, duplicate, forged, mixed JSON+guided, oversized, and malformed submissions fail closed.
- Existing JSON compatibility, empty values, no-input workflows, trusted-key validation, and total-size limits remain covered.
- Next.js production build remains the integration gate for the new authenticated guided page and semantic-plan link.

## Validation

- This slice must not be considered complete until GitHub Actions succeeds on the exact published head.
- Required gates remain deterministic pnpm lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, every AWS hosting/federation/release/deployment/web-demo/live-smoke/OIDC contract, and the complete test suite.
- No check may be weakened if CI exposes an integration defect; only one root-caused corrective CI-triggering commit is permitted for this run.

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
5. Compile, inspect the semantic plan, and use the guided Fresh Test input form rather than hand-authoring workflow JSON;
6. run a Fresh Test lasting beyond the control-plane HTTP timeout and confirm durable asynchronous completion;
7. approve/publish with recurrence, timezone, and any required explicitly non-secret scheduled inputs;
8. verify EventBridge Scheduler -> SQS -> Step Functions -> AgentCore execution, effect verification, timeline/reasoning/evidence/history, SES, and CloudWatch;
9. let controlled target authentication expire, require `TARGET_AUTH_REQUIRED`, complete the secure Live View repair, save the Browser Profile, resume once, and reach terminal success.
