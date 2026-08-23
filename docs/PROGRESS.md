# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with hardened Live View handoff, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `b6aa91c223eb2dbf6dcd9334e74949b238c42328` (`Harden target-auth Live View handoff`).
- GitHub Actions CI #267 passed completely on that exact head.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed until the new commit receives a completed successful run.

## This product slice — gate cloud Fresh Test before execution-plane invocation

### Product/cost defect and correction

The execution plane already revalidates automation state before Browser/model work, but the provider-neutral control plane could submit a production Fresh Test to the AgentCore Runtime port without first checking whether the automation was actually in `READY_TO_TEST` or `READY_TO_PUBLISH`.

That meant a stale or deliberately replayed authenticated API request against a `DRAFT`, `COMPILING`, `ACTIVE`, `PAUSED`, or other non-test-ready automation would still create an avoidable AgentCore Runtime invocation before the execution plane rejected it. The request remained safe from browser side effects, but the control plane was knowingly paying execution-plane cost for an invalid lifecycle transition.

`AutomationControlPlaneService.runFreshTest()` now resolves the automation under the authenticated tenant/user scope before constructing or submitting the execution request. Missing automations return `NOT_FOUND`; every status except `READY_TO_TEST` and `READY_TO_PUBLISH` returns a sanitized `CONFLICT`. Only a valid test-ready automation can reach `FreshTestExecutionPort.execute()`.

The Runtime worker remains authoritative after admission. If lifecycle state changes in the race between the control-plane read and Runtime execution, the existing execution-plane preflight still fails closed before Browser/model work.

### Security / tenant isolation

- Automation lookup uses the trusted `OwnershipScope`; request JSON cannot select another tenant/user.
- Cross-tenant Fresh Test attempts now stop before AgentCore Runtime invocation.
- No Browser Profile reference, BYOK secret reference, provider key, workload token, runtime identity capability, or raw provider/browser error is added to the control-plane response.
- Existing server-owned run IDs and Fresh Test runtime-variable validation remain unchanged.

### Idempotency / concurrency / retry / timeout

- Fresh Test run identity and durable occurrence idempotency are unchanged.
- This admission read is not treated as execution authority; Runtime still revalidates state and owns durable run creation/locking.
- No retry loop, lease, outbox, queue, or new recovery state was added.
- A state transition after the admission read is handled by the existing downstream fail-closed preflight rather than by optimistic assumptions in the API process.

### Side-effect verification / recovery

- Deterministic browser execution, constrained semantic fallback, expected-effect verification, checkpoints, Browser Profile persistence, human takeover, and resume behavior are unchanged.
- The change can only suppress invalid execution-plane submissions; it cannot broaden or authorize a browser action.

### Cost / observability

- A valid cloud Fresh Test adds one already-cheap scoped automation metadata read before AgentCore invocation.
- Invalid/stale Fresh Test requests now avoid AgentCore Runtime startup and all downstream Browser/model cost.
- No AWS resource, IAM permission, dependency, metric dimension, retained GitHub Actions artifact, or storage schema was added.

### Regression coverage

New provider-neutral tests prove:

- a `DRAFT` automation is rejected before `FreshTestExecutionPort.execute()`;
- a cross-tenant request is `NOT_FOUND` before execution-plane invocation;
- a `READY_TO_TEST` automation still forwards the same trusted scope, automation ID, run ID, and runtime variables and receives the asynchronous `ACCEPTED` result.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- An abandoned create attempt after a definitely-uncommitted metadata write may leave one retry-stable Browser Profile; blind cleanup remains unsafe under ambiguous metadata persistence.
- Expired capture records/control rows are not immediately deleted. They are non-authoritative after expiry and should be cleaned only by a deliberate retention policy if live storage volume makes that worthwhile.
- If immutable workflow persistence succeeds but the mutable automation-status update definitely fails, a retry can still create another workflow version from the same capture. A future idempotent compile identity should be added only if live deployment demonstrates this partial-failure window is material.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. create one automation and complete Live View capture;
4. compile and inspect the semantic plan, then run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. explicitly test an invalid/stale Fresh Test request and confirm no AgentCore execution-plane work is admitted;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, repair through hardened Live View handoff, save the repaired profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
