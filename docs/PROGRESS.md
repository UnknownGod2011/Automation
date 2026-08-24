# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head for this run: `a9a772f1792085c82fd532308be2b045564e340c` (`Align capture unconfigured regression coverage`).
- GitHub Actions CI #272 completed successfully on that exact head: deterministic lock verification, frozen install, strict `pnpm check`, all production package builds, AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contracts, and the full test suite passed.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the scheduling-capability change below; no pass is claimed until a completed successful run exists for the new commit.

## This product slice — make scheduling capability state fail closed

### Product/correctness defect

`ControlPlaneCapabilities.scheduling` already declared `CONFIGURED`, `LOCAL_MOCK`, and `NOT_CONFIGURED`, but publish and schedule-management commands did not treat that capability as an admission boundary. A stale or accidentally composed control plane could advertise scheduling as unavailable while still calling the lifecycle scheduler port.

Production AWS bootstrap currently refuses to construct the complete control plane when required scheduling configuration is missing, but the provider-neutral control-plane contract should remain truthful independently of one adapter composition. This is the same capability discipline already enforced for Capture and Fresh Test.

### Behavior

- Publish now resolves the automation under authenticated tenant/user scope, then rejects `scheduling = NOT_CONFIGURED` before `lifecycle.publish()` can mutate Scheduler or publication state.
- Update schedule, Pause, Resume, and Disable now perform the same ownership-first admission before invoking `AutomationScheduleLifecyclePort`.
- Missing/cross-tenant automations continue to return `NOT_FOUND` before deployment capability state is revealed.
- `CONFIGURED` and `LOCAL_MOCK` scheduling behavior remains unchanged.
- Missing schedule-lifecycle composition still returns the established `NOT_CONFIGURED` failure.

### Security / tenant isolation

- Tenant/user ownership is checked before scheduling capability is disclosed.
- Request bodies cannot choose tenant, Scheduler group, target role, queue, state machine, or other deployment authority.
- No Browser Profile reference, BYOK secret, workload token, schedule target ARN, provider error, or internal adapter exception is added to public responses.

### Idempotency / concurrency / retry / timeout

- Existing EventBridge schedule identifiers, occurrence idempotency, automation locking, and fail-closed DynamoDB↔Scheduler ordering remain authoritative.
- The unavailable path creates no Scheduler mutation, queue work, Step Functions execution, browser/model work, retry state, lease, or recovery state.
- No new retry loop or recovery subsystem is introduced.

### Side-effect verification / recovery

- Workflow execution, deterministic/semantic browser behavior, effect verification, checkpoints, human takeover, resume claims/leases, and reconciliation are unchanged.
- This change only suppresses schedule/control-plane side effects when scheduling is explicitly unavailable.

### Cost / observability

- Misconfigured/unavailable scheduling stops before EventBridge Scheduler mutation and before any downstream scheduled execution cost.
- The ownership preflight adds one DynamoDB automation read for schedule-control mutations; this is bounded and preferable to revealing capability state or mutating an unavailable deployment.
- No AWS resource, IAM permission, dependency, metric dimension, storage schema, or retained GitHub Actions artifact is added.

### Regression coverage

Provider-neutral tests prove:

- `NOT_CONFIGURED` Publish returns a sanitized scheduling-unavailable error and makes zero lifecycle publish calls;
- `NOT_CONFIGURED` schedule update/pause/resume/disable make zero schedule-adapter calls;
- cross-tenant publish/pause returns `NOT_FOUND` before capability disclosure or adapter work.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged and must be deliberately reviewed/promoted before the live AWS demo.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live product demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, deliberately promote the reviewed PR to the trusted deployment branch and run the protected real AWS vertical demonstration:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure a usable OpenAI BYOK credential;
3. capture a real workflow through AgentCore Live View, finish capture, compile, and inspect the semantic plan;
4. run a Fresh Test lasting more than 30 seconds and verify the UI follows durable state;
5. exercise `capture`, `cloudExecution`, and `scheduling` `NOT_CONFIGURED` states and confirm each causes zero corresponding cloud work;
6. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
