# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with hardened Live View handoff, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `57f2373f75060a73911af753aa763875de1125f7` (`Gate cloud Fresh Test before Runtime invocation`).
- GitHub Actions CI #268 passed completely on that exact head.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed until the new commit receives a completed successful run.

## This product slice — make Fresh Test capability state fail closed

### Product/correctness defect and correction

`ControlPlaneCapabilities.cloudExecution` has three explicit states: `CONFIGURED`, `LOCAL_MOCK`, and `NOT_CONFIGURED`. `AutomationControlPlaneService.runFreshTest()` correctly used the trusted AgentCore execution port for `CONFIGURED`, but every other state fell through to the in-process lifecycle implementation. As a result, `NOT_CONFIGURED` silently behaved like `LOCAL_MOCK`.

That violates the repository's deployment contract: missing cloud execution configuration must remain an explicit product state and must never fabricate success or silently start a different browser/model execution path. In production composition this could also make behavior depend on whichever lifecycle implementation happened to be injected instead of the declared capability state.

Fresh Test dispatch now treats the three capability states distinctly:

- `CONFIGURED` -> use the trusted `FreshTestExecutionPort` and keep AgentCore Runtime authoritative;
- `LOCAL_MOCK` -> use the deterministic in-process lifecycle used by local product tests;
- `NOT_CONFIGURED` -> return a sanitized `NOT_CONFIGURED` error before either execution path starts.

The existing automation ownership/lifecycle admission still runs first. Runtime remains independently authoritative after a configured cloud submission.

### Security / tenant isolation

- Tenant/user ownership remains derived from trusted `OwnershipScope` and is checked before capability dispatch.
- `NOT_CONFIGURED` does not expose Browser Profile references, BYOK references/keys, workload tokens, runtime identities, or provider/browser errors.
- The HTTP boundary maps the error to a stable 503 response without invoking local or cloud execution.
- No permission boundary or client-controlled capability flag was added.

### Idempotency / concurrency / retry / timeout

- Fresh Test run IDs, occurrence idempotency, automation locking, and asynchronous AgentCore execution are unchanged.
- `NOT_CONFIGURED` now creates no run and starts no execution path, so there is nothing new to retry or reconcile.
- No queue, outbox, lease, heartbeat, or recovery state was added.

### Side-effect verification / recovery

- Deterministic browser execution, constrained semantic fallback, expected-effect verification, checkpoint persistence, Browser Profile persistence, and human takeover/resume are unchanged.
- This change only narrows dispatch authority; it cannot authorize a browser/model side effect.

### Cost / observability

- A `NOT_CONFIGURED` Fresh Test now stops before AgentCore Browser/model cost and before local mock execution.
- `LOCAL_MOCK` remains available for deterministic no-credential product tests.
- No AWS resource, IAM permission, dependency, metric dimension, storage schema, or retained GitHub Actions artifact was added.

### Regression coverage

New provider-neutral tests prove:

- `NOT_CONFIGURED` rejects a test-ready automation without calling the local lifecycle;
- `NOT_CONFIGURED` also does not call a supplied cloud execution port;
- the HTTP API returns sanitized 503 `NOT_CONFIGURED` for that state;
- `LOCAL_MOCK` still uses the in-process lifecycle and never calls the cloud execution port.

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
5. deliberately exercise both invalid lifecycle state and `NOT_CONFIGURED` Fresh Test capability and confirm no local or AgentCore execution work starts;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, repair through hardened Live View handoff, save the repaired profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
