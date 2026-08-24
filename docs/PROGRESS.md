# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with hardened Live View handoff, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head for this run: `3d8ccf7bce0376a6d06aed7525efa4b7ccd9e963` (`Preserve stable capture unavailable response`).
- GitHub Actions CI #271 reached and passed deterministic lock verification, frozen install, strict `pnpm check`, all production packaging paths, and all AWS deployment/security/demo/OIDC contract checks.
- CI #271 then failed only in `pnpm test` on one stale legacy assertion in `packages/core/src/control-plane.test.ts`: it still expected `CaptureSessionStarter.start()` to be called for `capture = NOT_CONFIGURED`, while the intended fail-closed behavior correctly makes zero starter calls.
- The dedicated capture-capability tests already proved the new zero-allocation behavior and passed in CI #271.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this correction; no pass is claimed until the new commit receives a completed successful run.

## This product slice — finish Capture NOT_CONFIGURED validation cleanly

### Product/correctness behavior

`ControlPlaneCapabilities.capture` is an explicit deployment/product state. `AutomationControlPlaneService.beginCapture()` now checks authenticated ownership first and then fails closed when `capture = NOT_CONFIGURED`, returning the established sanitized response before the configured `CaptureSessionStarter` can allocate AgentCore Browser compute or issue a Live View capability.

This correction does not change production code. It aligns the final stale legacy service test with the already-implemented invariant:

- `capture = NOT_CONFIGURED` returns `{ kind: "NOT_CONFIGURED", reason: "AgentCore capture is not configured" }`;
- `CaptureSessionStarter.start()` is not called;
- the HTTP boundary returns the established 503 response;
- `CONFIGURED` and `LOCAL_MOCK` continue through the existing starter port.

### CI #271 root cause and correction

CI #271 demonstrated that the implementation, strict type/build checks, production packages, and deployment contracts were already healthy. The sole remaining failure was a pre-existing assertion that encoded the old behavior by expecting a call to `captureSessions.start` under `NOT_CONFIGURED`.

The test now asserts `not.toHaveBeenCalled()`, matching the dedicated regression suite and the intended zero-allocation capability contract. No production behavior, test gate, TypeScript strictness, dependency rule, or deployment validation is weakened.

### Security / tenant isolation

- Missing or cross-tenant automations still resolve to `NOT_FOUND` before capability state is revealed.
- A `NOT_CONFIGURED` request cannot allocate AgentCore Browser compute or create/sign a Live View URL.
- No Browser Profile reference, capture session ID, signed Live View capability, BYOK secret, workload token, or provider/browser error is introduced into the unavailable response.
- Capability state remains deployment-owned rather than client-controlled.

### Idempotency / concurrency / retry / timeout

- Existing capture-current-pointer conditional claims and duplicate-active-capture fencing are unchanged.
- `NOT_CONFIGURED` creates no capture session, retry state, queue work, lease, outbox, heartbeat, or reconciliation state.
- No additional recovery subsystem is introduced.

### Side-effect verification / recovery

- Workflow capture contracts, compiler verification requirements, deterministic execution, semantic fallback, scheduled execution, and human repair/resume are unchanged.
- This slice only ensures the regression suite enforces the already-correct suppression of capture side effects under explicit deployment unavailability.

### Cost / observability

- The fail-closed path prevents AgentCore Browser/Live View cost in an unavailable deployment.
- This correction adds no AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact.

### Regression coverage

Provider-neutral coverage now consistently proves:

- `NOT_CONFIGURED` returns the established unavailable result and makes zero `CaptureSessionStarter.start()` calls;
- the HTTP boundary returns 503 without starting capture;
- both `CONFIGURED` and `LOCAL_MOCK` still call the configured capture starter and preserve the existing ready result;
- the legacy control-plane regression suite and dedicated capture-capability suite agree on the same authority boundary.

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

After exact-head CI is green, deliberately promote the reviewed PR to the trusted deployment branch and run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. exercise `capture = NOT_CONFIGURED` and confirm zero AgentCore Browser/Live View work, then enable capture and complete one real Live View demonstration;
4. compile and inspect the semantic plan, then run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. exercise invalid lifecycle state and `NOT_CONFIGURED` Fresh Test capability and confirm no local or AgentCore execution work starts;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus verification/history/CloudWatch/SES;
7. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.