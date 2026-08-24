# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with hardened Live View handoff, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `7456348acde590bbbb0751acecda81552c327533` (`Fail closed when Fresh Test is not configured`).
- GitHub Actions CI #269 passed completely on that exact head.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed until the new commit receives a completed successful run.

## This product slice — make Capture capability state fail closed

### Product/correctness defect and correction

`ControlPlaneCapabilities.capture` is an explicit deployment/product state, but `AutomationControlPlaneService.beginCapture()` previously ignored it and always called `CaptureSessionStarter.start()` after ownership lookup. The concrete production starter normally returns `NOT_CONFIGURED` when its own AWS composition is absent, but the declared capability itself was not authoritative. An accidental or stale composition could therefore advertise capture as unavailable while still allocating AgentCore Browser compute and issuing a Live View capability.

Capture admission now mirrors the explicit Fresh Test capability discipline:

- ownership and automation existence are checked first under the trusted tenant/user scope;
- `capture = NOT_CONFIGURED` returns a stable `NOT_CONFIGURED` result before the capture starter is called;
- `capture = CONFIGURED` and `capture = LOCAL_MOCK` continue through the existing `CaptureSessionStarter` port;
- the existing HTTP route maps the fail-closed result to 503 without browser/session allocation.

The starter remains independently responsible for lifecycle state, active-capture concurrency, Browser Profile ownership, Live View safety, and AWS-specific configuration after admission.

### Security / tenant isolation

- Cross-tenant or missing automation requests still resolve to `NOT_FOUND` before capability state is revealed.
- A `NOT_CONFIGURED` request cannot allocate an AgentCore Browser session or create/sign a Live View URL.
- No Browser Profile reference, capture session ID, signed Live View capability, BYOK secret, workload token, or provider/browser error is introduced into the unavailable response.
- Capability state remains deployment-owned rather than client-controlled.

### Idempotency / concurrency / retry / timeout

- Existing capture-current-pointer conditional claims and duplicate-active-capture fencing are unchanged.
- `NOT_CONFIGURED` creates no capture session and has no retry/reconciliation state.
- No new queue, lease, outbox, retry loop, heartbeat, or recovery subsystem was added.

### Side-effect verification / recovery

- Workflow capture contracts, compiler verification requirements, deterministic execution, semantic fallback, and human recovery are unchanged.
- This change only suppresses capture-side effects when deployment capability is explicitly unavailable.

### Cost / observability

- Misconfigured/unavailable deployments now stop before AgentCore Browser/Live View cost.
- No AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact was added.

### Regression coverage

New provider-neutral tests prove:

- `NOT_CONFIGURED` returns a stable unavailable result and makes zero `CaptureSessionStarter.start()` calls;
- the HTTP boundary returns 503 without starting capture;
- both `CONFIGURED` and `LOCAL_MOCK` still call the configured capture starter and preserve the existing ready result.

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
3. explicitly exercise `capture = NOT_CONFIGURED` and confirm no AgentCore Browser/Live View work starts, then enable capture and complete one real Live View demonstration;
4. compile and inspect the semantic plan, then run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. deliberately exercise both invalid lifecycle state and `NOT_CONFIGURED` Fresh Test capability and confirm no local or AgentCore execution work starts;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, repair through hardened Live View handoff, save the repaired profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
