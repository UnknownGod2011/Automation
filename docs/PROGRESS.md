# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `369a8b6b1e45b1d0e23d80d3f630e662db52058c` (`Treat expired captures as restartable`).
- GitHub Actions CI #265 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed here until the new run completes successfully.

## This product slice — compile readiness follows durable lifecycle state

### Product defect and correction

The automation detail page previously rendered **Compile latest capture** whenever any completed capture existed. A completed capture is intentionally retained after compilation, so the same button remained visible in `READY_TO_TEST`, `TESTING`, and `READY_TO_PUBLISH` even though the provider-neutral lifecycle correctly permits compilation only from `COMPILING`.

That produced a misleading live path: after a successful compile the product still invited a second compile, and a stale form POST needlessly called the control plane only to be rejected as a generic operation failure.

A new web-only `compileCapturePresentation()` boundary now derives compile readiness from the same durable facts the lifecycle uses. The Compile action is available only when automation state is `COMPILING` **and** the sanitized control-plane summary proves a completed capture exists. Already-compiled states explain that the user should review/test/correct instead of showing another compile button. Retained historical captures on published/paused/disabled automations are explicitly non-compilable until the supported revision flow produces a new authoring transition.

The POST mutation independently reloads the authenticated automation summary and checks the same rule before sending the compile command. A stale rendered form therefore fails locally with sanitized invalid-input behavior rather than causing an unnecessary workflow mutation request. The provider-neutral lifecycle remains the final authority and still revalidates `COMPILING` plus the server-resolved latest capture.

### Security / tenant isolation

- Tenant/user ownership still comes exclusively from the authenticated control-plane client; the browser supplies no trace ID, workflow ID, tenant, user, or Browser Profile reference.
- Compile readiness uses only sanitized automation status plus completed-capture timestamp metadata already present in the authenticated summary.
- Trace IDs, Browser session IDs, Browser Profile references, cookies, BYOK keys, workload tokens, raw provider errors, and captured values remain server-side.
- The stale-form guard does not create a new authorization path; it only suppresses a request that the control plane would reject anyway.

### Idempotency / concurrency / retry / timeout

- No new retry loop, lease, queue, outbox, or recovery machinery was added.
- A stale page cannot intentionally request a second compile after durable automation state has advanced beyond `COMPILING`.
- A race between the web preflight and the actual control-plane command remains safe because the provider-neutral lifecycle revalidates state at mutation time.
- Workflow-version persistence semantics are unchanged; this slice prevents the ordinary sequential/stale-browser duplicate path rather than claiming transactionality across immutable workflow storage and automation metadata.

### Side-effect verification / recovery

- Browser execution, semantic reasoning, expected-effect verification, run checkpoints, scheduling, target-auth takeover, human-resolution claims, resume leases, heartbeat, and effect reconciliation are unchanged.
- Compilation itself does not execute the target website; this slice only aligns product readiness with the existing authoring state machine.

### Cost / observability

- Stale compile clicks no longer invoke the control plane/Lambda for a command that is known to be invalid from trusted server-side summary state.
- No AWS resource, table, queue, browser/model call, metric dimension, IAM permission, dependency, or retained GitHub Actions artifact was added.
- User-facing copy now distinguishes “capture not yet complete,” “already compiled,” and “historical capture retained but not authorable,” reducing generic request-failure noise during the real demo.

### Regression coverage

New web unit coverage proves:

- `COMPILING` + completed capture is the only compile-ready state;
- `READY_TO_TEST`, `TESTING`, and `READY_TO_PUBLISH` never advertise a second compile;
- `COMPILING` without authoritative completed-capture metadata fails closed;
- retained captures in `ACTIVE`, `PAUSED`, and `DISABLED` remain non-compilable through this action.

The production page and POST route both consume the same helper so presentation and mutation preflight cannot drift independently.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains a draft/unmerged branch. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- An abandoned create attempt after a definitely-uncommitted metadata write may leave one retry-stable Browser Profile; blind cleanup remains unsafe under ambiguous metadata persistence.
- Expired capture records/control rows are not immediately deleted. They are non-authoritative after expiry and should be cleaned only by a deliberate retention policy if live storage volume makes that worthwhile.
- If immutable workflow persistence succeeds but the mutable automation-status update definitely fails, a retry can still create another workflow version from the same capture. This is not exercised by the normal/stale web path fixed here; a future idempotent compile identity should be added only if live deployment demonstrates this partial-failure window is material.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. create one automation and validate same-form replay converges on one automation/Browser Profile;
4. complete Live View capture, verify Compile appears exactly once while state is `COMPILING`, then confirm the compiled semantic plan replaces the stale compile action;
5. run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
