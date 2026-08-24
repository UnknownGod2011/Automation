# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, durable trusted traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head for this run: `49fb49aa54076a94318968c9d81517b814ff791a` (`Keep capture traces behind trusted worker boundary`).
- GitHub Actions CI #275 completed successfully on that exact head: deterministic lock verification, frozen install, strict `pnpm check`, all production package builds, AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contracts, and the full test suite passed.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the Fresh Test identity change below; no pass is claimed until a completed successful run exists for the new commit.

## This product slice — keep Fresh Test run identity server-owned at the authenticated API boundary

### Product/security defect

The Next.js product stopped asking users for Fresh Test run IDs earlier, but the ordinary authenticated control-plane HTTP route still parsed `runId` from request JSON and forwarded it as the durable Fresh Test/idempotency identity.

A normal Cognito-authenticated caller could therefore choose an internal run identity directly, including attempting collisions with another intentional Fresh Test for the same automation. Tenant ownership and execution admission still prevented cross-tenant execution, but durable run identity should not be caller authority in the end-user API at all.

### Behavior

- `AutomationControlPlaneHttpHandler` now mints a bounded `test-...` run identity itself for every accepted authenticated Fresh Test submission.
- A request-body `runId` is ignored and has no execution authority.
- The authenticated HTTP request no longer requires a run ID; runtime variables remain the only Fresh Test execution data accepted from that body.
- The provider-neutral `AutomationControlPlaneService.runFreshTest()` contract still accepts an explicit run ID for trusted internal/local composition. This slice narrows only the end-user HTTP transport boundary.
- The generated run ID is returned only through the existing accepted/run result, where it is required for durable history/polling correlation.
- Generated identities are format-bounded and an invalid server-side identity factory fails closed before Fresh Test submission.

### Security / tenant isolation

- Tenant/user ownership continues to come exclusively from authenticated context; spoofed body ownership fields have no authority.
- A client can no longer manufacture the durable Fresh Test occurrence identity used by downstream idempotency/run state.
- Runtime variables remain subject to the existing product-level closed `capture_input_N` requirement set and execution-plane validation.
- BYOK keys, AgentCore workload tokens, Browser Profile/session identifiers, selectors, raw provider/browser errors, and capture trace identities remain outside this request authority.

### Idempotency / concurrency / retry / timeout

- The existing durable Fresh Test occurrence key and automation execution lease remain the cross-process duplicate/concurrency authority after submission.
- This change does not add an HTTP retry key. A genuinely repeated user submission is still a distinct intentional Fresh Test, while the UI suppresses a second test during an active run and the durable automation lease provides the final overlap fence.
- Asynchronous AgentCore execution remains unchanged: the control plane receives the accepted server-generated run ID promptly and durable run/checkpoint state remains authoritative for completion.
- No retry loop, outbox, lease, queue, heartbeat, or crash-recovery subsystem is added.

### Side-effect verification / recovery

- Browser execution, semantic fallback, expected-effect verification, profile-save-before-success, checkpoints, human takeover/resume, and crash reconciliation are unchanged.
- The change only removes end-user authority over the Fresh Test run identity that reaches those existing execution controls.

### Cost / observability

- No additional AWS request, Browser session, model invocation, database operation, metric dimension, IAM permission, dependency, or retained GitHub Actions artifact is added.
- Invalid server-generated identities stop before AgentCore/local Fresh Test execution submission, avoiding execution-plane cost.
- Existing run IDs remain available as bounded internal correlation identifiers in durable history/telemetry; raw caller-supplied values no longer enter that namespace through this API.

### Regression coverage

Provider-neutral HTTP tests prove:

- a caller-supplied `runId` and spoofed tenant/user values cannot alter the server-generated Fresh Test command;
- an authenticated Fresh Test request with no `runId` is accepted and receives the server-minted identity;
- malformed server-side identity generation returns sanitized `CONFLICT` and makes zero Fresh Test submission calls.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged and must be deliberately reviewed/promoted before the live AWS demo.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- If a Browser Profile is created and metadata definitely never commits, an abandoned creation attempt can leave one retry-stable orphan profile. Blind deletion remains unsafe when write outcome is ambiguous; cleanup should be driven by live cost evidence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live product demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, deliberately promote the reviewed PR to the trusted deployment branch and run the protected real AWS vertical demonstration:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure a usable OpenAI BYOK credential;
3. verify the same automation-creation attempt converges after an intentionally uncertain/repeated submission without a second Browser Profile;
4. capture a real workflow through AgentCore Live View and verify only the trusted worker completion path can make it compile-ready;
5. finish capture, compile, inspect the semantic plan, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state; also verify an attempted caller-provided Fresh Test run ID cannot choose the durable run identity;
6. exercise `capture`, `cloudExecution`, and `scheduling` `NOT_CONFIGURED` states and confirm each causes zero corresponding cloud work;
7. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
