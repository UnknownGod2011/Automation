# Production Progress

Updated: 2026-08-27

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `68d7db5414a07c3aa7482e2894363ae3175963e5` (`Clarify guided runtime input semantics`) and push CI #384 completed successfully on that exact SHA. There were no open pull requests. The repository remains organized as a provider-neutral core/contracts layer, a Next.js authenticated control plane, AWS adapters/IaC, and deterministic release/deployment scripts.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, automation dashboard/create/revision, isolated AgentCore Live View capture with persisted Browser Profiles and traces, semantic workflow compilation/inspection, asynchronous Fresh Test, guided runtime/scheduled inputs, publish/schedule management, EventBridge Scheduler → SQS → Step Functions → AgentCore Runtime execution, OpenAI BYOK routing through AgentCore Identity, deterministic-first browser execution with constrained semantic fallback, mandatory effect verification, run history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — make initial Publish input guidance semantic

### Product defect

Fresh Test and post-publish Scheduled Inputs already explain unresolved captured values in semantic terms: TYPE needs ordinary text and SELECT needs the visible option label. Initial Publish still rendered every reusable value as the generic `Step N reusable scheduled value`. That left the final approval step less understandable than the two surrounding product surfaces even though the same trusted workflow inspection was already available on the page.

### Change

- Added a shared `publishRuntimeInputFields()` presentation boundary that combines the existing opaque `scheduledInput-N` field mapping with the already-sanitized semantic runtime-input guidance.
- Initial Publish now renders TYPE values as text values and SELECT values as visible option labels, with the same guidance used by Fresh Test and post-publish Scheduled Inputs.
- The browser still submits only opaque ordinal field names. Internal `capture_input_N` keys remain server-side and are reconstructed only by the existing trusted publish parser.
- Malformed workflow input metadata, invalid capture-variable keys, unsupported semantic steps, or an ordering mismatch fail closed and suppress Publish rather than guessing.
- Workflows with no unresolved captured values remain publishable without a non-secret-value acknowledgement.

No workflow graph, capture, browser executor, Scheduler, persistence, credential, or recovery semantics changed.

### Security / tenant isolation

The new helper consumes only authenticated, sanitized workflow-inspection metadata plus the existing trusted runtime-input requirements. It does not receive or expose captured values, selectors, durable workflow/node IDs, Browser Profile/session identifiers, BYOK material, workload tokens, provider errors, or tenant/user authority. Tenant ownership remains enforced by the authenticated control-plane reads and by the publish mutation itself.

### Idempotency / concurrency / retry / timeout

This is presentation-only. Publish still reloads trusted workflow requirements server-side immediately before mutation, validates exact opaque ordinal fields, verifies successful Fresh-Test provenance and the latest immutable workflow version, and then performs the existing Scheduler-backed lifecycle transition. A stale page gains no new workflow-variable or scheduling authority. Retry and timeout behavior are unchanged.

### Side-effect verification / user recovery

No execution or verification gate changed. TYPE, SELECT, deterministic browser actions, semantic fallback, effect verification, schedule admission, and human repair/resume retain their existing contracts. The slice only makes the reusable values understandable before production scheduling begins.

### Cost / observability

No AWS request, Browser/AgentCore allocation, model call, database operation, queue delivery, new resource, IAM permission, dependency, or retained Actions artifact is added. The automation detail page already loads the workflow inspection and runtime-input requirements needed for Publish.

### Regression coverage

New tests require the Publish presentation boundary to:

- preserve the trusted runtime-input ordering while keeping browser field names opaque;
- label SELECT inputs as visible option labels and TYPE inputs as text values;
- fail closed for unsupported semantic metadata or invalid capture-variable keys;
- accept workflows with no unresolved runtime values.

GitHub Actions on the exact branch head remains authoritative. This document does not claim the new slice is green until that run exists and completes successfully.

## Known production risks / intentionally parked work

- GitHub currently reports `main` as unprotected. The manual AWS deployment workflow correctly refuses OIDC AWS credentials unless the checked-out SHA is the current protected `main` head. Repository/Environment protection must be configured operationally before first real deployment.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB ↔ EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File inputs, passwords, miscellaneous controls, and native multi-select remain intentionally unsupported. Password/authentication stays in Browser Profile + human-auth flows. Add new primitives only with deterministic execution and explicit verification.

## Next product milestone

After exact-head CI and promotion of this slice, the highest-value milestone remains the protected real AWS vertical demonstration, not further recovery hardening:

1. Configure actual `main`/production-environment protection so the OIDC deployment gate can issue credentials.
2. Deploy immutable artifacts and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
3. Sign in through Cognito/Google and configure one OpenAI BYOK credential.
4. Capture the controlled first-party workflow in AgentCore Live View and finish trusted capture/evidence persistence.
5. Compile and inspect the semantic plan; confirm unresolved TYPE and SELECT inputs are described in human terms.
6. Run a >30-second asynchronous Fresh Test using the guided values and inspect timeline/reasoning/run evidence.
7. Approve/publish with recurrence/timezone and the same semantic guided reusable values.
8. Observe EventBridge/SQS/Step Functions/AgentCore execution, effect verification, history, SES, and CloudWatch.
9. Let the controlled target authentication expire, use secure Live View repair, save the Browser Profile, resume, and confirm terminal success/reporting.

Concrete defects from that environment should determine subsequent engineering priorities.
