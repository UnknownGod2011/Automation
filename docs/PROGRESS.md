# Production Progress

Updated: 2026-08-27

## Current validated baseline

`main` is `520e6b6faf447170b11cb7ba6819e7c6f988fdac` (`Exercise RADIO in controlled AWS demo`). Push CI #380 completed successfully on that exact SHA. The repository is organized as a provider-neutral core/contracts layer, a Next.js authenticated control plane, AWS adapters/IaC, and deterministic release/deployment scripts.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, automation dashboard/create/revision, isolated AgentCore Live View capture with persisted Browser Profiles and traces, semantic workflow compilation/inspection, asynchronous Fresh Test, guided runtime/scheduled inputs, publish/schedule management, EventBridge Scheduler → SQS → Step Functions → AgentCore Runtime execution, OpenAI BYOK routing through AgentCore Identity, deterministic-first browser execution with constrained semantic fallback, mandatory effect verification, run history/timeline/reasoning/evidence, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — fail closed on native multi-select capture

### Defect

The capture installer previously emitted the same `select` marker for both ordinary `<select>` and `<select multiple>`. The compiler therefore could not distinguish a list-valued multi-select interaction from the supported single-value `SELECT` primitive. A demonstrated multi-select could silently compile into the wrong replay semantics.

### Change

- Browser capture now emits `select-multiple` for native multiple selects on both click and change paths.
- The AWS capture classifier deliberately maps `select-multiple` to the existing unsupported `OTHER` control category. This preserves the current closed capture schema while preventing the single-value `SELECT` compiler path from accepting the interaction.
- The initiating multi-select click is coalesced with its change event, just like other discrete controls, so one unsupported demonstration does not create a misleading extra CLICK action before compilation fails.
- Existing ordinary single-select behavior is unchanged.
- Compilation remains fail-closed through the existing unsupported-control path; the authenticated product already turns that closed compiler refusal into an actionable reteach message.

This slice intentionally does **not** invent multi-select execution. Supporting it safely requires an explicit list-valued provider-neutral primitive, deterministic Playwright selection semantics, runtime-input representation, and independent selected-set verification.

### Security / tenancy

No tenant authority or secret boundary changes. Raw selected values remain excluded from capture data. The change does not expose Browser Profile/session IDs, trace IDs, BYOK material, workload tokens, selectors, or provider errors to the browser.

### Idempotency / concurrency / retries

No persistence, scheduling, retry, lease, or human-resume behavior changes. Discrete click/change coalescing reduces duplicate-action risk during capture. Unsupported multi-select reaches Compile as one unsupported INPUT event and cannot execute.

### Side-effect verification

No verification gate is weakened. Supported single-select continues to require `capture:select-bound-value` verification. Multi-select is rejected before Fresh Test or scheduled browser execution because no truthful list-valued verification contract exists yet.

### Cost / observability

No AWS resource, model call, browser allocation, database, queue, or IAM permission is added. Failing during Compile avoids Fresh Test/AgentCore/model cost for a workflow the runtime cannot faithfully replay.

### Regression coverage

New tests require:

- browser instrumentation to distinguish `select` from `select-multiple`;
- single-select classification to remain `SELECT`;
- multi-select classification to remain unsupported and its click to be coalesced;
- the compiler to reject the unsupported multi-select representation instead of producing a `SELECT` node.

GitHub Actions on the exact branch head remains authoritative; this document does not claim the new slice is green until that run exists and completes successfully.

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
4. Capture the controlled first-party workflow in AgentCore Live View: SELECT → RADIO → TYPE → CHECK → one verified SUBMIT.
5. Finish trusted capture, inspect retained capture evidence, Compile, and inspect the semantic plan.
6. Run a >30-second asynchronous Fresh Test using guided values and inspect timeline/reasoning/run evidence.
7. Approve/publish with recurrence/timezone and guided reusable non-secret scheduled inputs.
8. Observe EventBridge/SQS/Step Functions/AgentCore execution, effect verification, history, SES, and CloudWatch.
9. Let the controlled target authentication expire, use secure Live View repair, save the Browser Profile, resume, and confirm terminal success/reporting.

Concrete defects from that environment should determine subsequent engineering priorities.
