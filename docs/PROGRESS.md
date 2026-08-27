# Production Progress

Updated: 2026-08-27

## Current validated baseline

`main` is `58dd0a66a911afb4304496523bbc11fc101de727` (`Fail closed on captured multi-select controls`). Push CI #382 completed successfully on that exact SHA. The repository is organized as a provider-neutral core/contracts layer, a Next.js authenticated control plane, AWS adapters/IaC, and deterministic release/deployment scripts.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, automation dashboard/create/revision, isolated AgentCore Live View capture with persisted Browser Profiles and traces, semantic workflow compilation/inspection, asynchronous Fresh Test, guided runtime/scheduled inputs, publish/schedule management, EventBridge Scheduler → SQS → Step Functions → AgentCore Runtime execution, OpenAI BYOK routing through AgentCore Identity, deterministic-first browser execution with constrained semantic fallback, mandatory effect verification, run history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — make guided runtime inputs semantic

### Product defect

The trusted workflow inspection already knows which semantic step owns each unresolved captured value, but the main guided Fresh Test and reusable Scheduled Inputs surfaces labeled every field as a generic “runtime value.” In the controlled vertical this is especially confusing for SELECT: the user must provide the visible option label, while TYPE expects ordinary text. The product should not require users to infer those semantics from internal implementation details.

### Change

- Added one shared web presentation policy that resolves each trusted runtime-input step against sanitized semantic workflow metadata.
- TYPE inputs are presented as a **text value** with explicit non-secret typing guidance.
- SELECT inputs are presented as an **option label** with guidance to use the visible label the deterministic browser primitive will select.
- Fresh Test uses those semantic labels directly while continuing to submit only opaque ordinal `runtimeInput-N` field names.
- The compiled-workflow review card now tells the user which semantic value each unresolved step requires before they enter the Fresh Test flow.
- Published Scheduled Inputs reuse the same semantic presentation, while their server-side `scheduledInput-N` mapping and write-only storage contract remain unchanged.
- If runtime-input metadata points at a missing, duplicate, malformed, or unsupported semantic step, the presentation layer fails closed rather than guessing at the required value.

No execution graph, runtime binding, browser primitive, or persistence schema changes in this slice.

### Security / tenancy

The helper consumes only the already-sanitized workflow-inspection step number and node kind. It does not receive or expose capture values, `capture_input_N` keys, selectors, workflow/node IDs, Browser Profile/session identifiers, BYOK material, workload tokens, or provider errors. Tenant/user ownership remains enforced by the authenticated control-plane reads that produce the workflow inspection.

### Idempotency / concurrency / retries / timeout

No mutation authority or retry behavior changes. Form submissions still use the existing opaque ordinal mappings and the existing server-side trusted-requirement validation immediately before Fresh Test or scheduled-input mutation. A stale page cannot create new workflow-variable authority because browser field labels are presentation-only.

### Side-effect verification / user recovery

No verification gate changes. TYPE, SELECT, CHECK/RADIO, CLICK/SUBMIT, navigation, and human recovery keep their existing deterministic/semantic and verification rules. This slice only makes the already-required runtime value understandable before cloud execution begins.

### Cost / observability

No AWS request, Browser/AgentCore allocation, model call, database operation, queue delivery, new resource, IAM permission, dependency, or retained Actions artifact is added. The scheduled-input page already loads workflow inspection; Fresh Test already loads it as well.

### Regression coverage

New tests require the semantic input policy to:

- label SELECT inputs as visible option labels and TYPE inputs as text values;
- preserve the trusted runtime-input ordering used by opaque ordinal fields;
- fail closed for missing, duplicate, malformed, or unsupported semantic step metadata;
- accept workflows with no unresolved runtime values.

GitHub Actions on the exact branch head remains authoritative; this document does not claim the new slice is green until that run exists and completes successfully.

## Known production risks / intentionally parked work

- GitHub currently reports `main` as unprotected. The manual AWS deployment workflow correctly refuses OIDC AWS credentials unless the checked-out SHA is the current protected `main` head. Repository/Environment protection must be configured operationally before first real deployment.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB ↔ EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File inputs, passwords, miscellaneous controls, and native multi-select remain intentionally unsupported. Password/authentication stays in Browser Profile + human-auth flows. Add new primitives only with deterministic execution and explicit verification.
- Initial Publish currently uses guided per-step fields but still uses generic reusable-value labels. Fresh Test, workflow review, and post-publish Scheduled Inputs become semantic in this slice; initial Publish should reuse the same presentation policy in a later coherent page refactor rather than duplicating logic inside the large detail page.

## Next product milestone

After exact-head CI and promotion of this slice, the highest-value milestone remains the protected real AWS vertical demonstration, not further recovery hardening:

1. Configure actual `main`/production-environment protection so the OIDC deployment gate can issue credentials.
2. Deploy immutable artifacts and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
3. Sign in through Cognito/Google and configure one OpenAI BYOK credential.
4. Capture the controlled first-party workflow in AgentCore Live View and finish trusted capture/evidence persistence.
5. Compile and inspect the semantic plan; confirm unresolved TYPE and SELECT inputs are described in human terms.
6. Run a >30-second asynchronous Fresh Test using the guided values and inspect timeline/reasoning/run evidence.
7. Approve/publish with recurrence/timezone and explicitly non-secret reusable scheduled inputs.
8. Observe EventBridge/SQS/Step Functions/AgentCore execution, effect verification, history, SES, and CloudWatch.
9. Let the controlled target authentication expire, use secure Live View repair, save the Browser Profile, resume, and confirm terminal success/reporting.

Concrete defects from that environment should determine subsequent engineering priorities.
