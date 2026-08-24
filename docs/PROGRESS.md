# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, durable trusted traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation and CI root cause

- Incoming PR #1 head for this run: `52ed8ba82cdf3a5f1403faae04f425f30ba1de65` (`Keep Fresh Test run identity server-owned`).
- GitHub Actions CI #276 completed successfully on that exact incoming head.
- Normal product commit `cf9b3eab7ca78671f08320f525f4da9b08eb3954` (`Keep Publish workflow version server-owned`) passed deterministic lock verification, frozen install, strict `pnpm check`, all three production package builds, and every AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract in CI #277.
- CI #277 failed only in the final core test suite: 299 core tests passed and one legacy request-validation test failed because the new Publish handler consulted Fresh Test history before validating the supplied schedule. The malformed schedule therefore returned `409 CONFLICT` for missing Fresh Test provenance instead of the established `400 BAD_REQUEST` schedule-shape response.
- The new publish-authority regression suite itself passed in CI #277.
- The corrective change preserves the product invariant while restoring request-validation ordering: the schedule is parsed and validated first, then trusted Fresh Test provenance is resolved, then publication is attempted.
- Exact-head GitHub Actions remains authoritative for the corrective head; no pass is claimed until a completed successful run exists for it.

## This product slice — keep Publish workflow version server-owned at the authenticated API boundary

### Product/security defect

The Next.js product had already stopped asking the user to choose a workflow version during approval/publish, but the ordinary authenticated control-plane HTTP route still parsed `workflowVersion` from request JSON and forwarded it as publication authority.

The core publish lifecycle already validates `READY_TO_PUBLISH` and rejects a workflow version that is not the latest immutable tested version, so this was not a direct bypass. However, the end-user API should not let the caller choose an internal workflow-version identity when durable successful Fresh Test history determines the legitimate publication candidate.

### Behavior

- `POST /v1/automations/:automationId/publish` no longer parses caller-supplied `workflowVersion` as authority.
- The authenticated HTTP boundary resolves run history under the trusted tenant/user scope and selects the highest workflow version whose run is both `SUCCEEDED` and classified `FRESH_TEST`.
- Successful scheduled runs and failed Fresh Tests cannot authorize publication.
- Caller-supplied `workflowVersion`, tenant ID, and user ID have no publication authority.
- If there is no successful Fresh Test in durable history, Publish returns sanitized `409 CONFLICT` before `publishAutomation()` is invoked.
- Malformed schedule input is still rejected as `400 BAD_REQUEST` before the history read or any Scheduler-backed mutation.
- `AutomationControlPlaneService.publishAutomation()` and the provider-neutral lifecycle still accept explicit workflow versions for trusted internal/local composition. This slice narrows only the authenticated end-user HTTP transport.
- The lifecycle remains the final authority for `READY_TO_PUBLISH`, latest immutable workflow version, scheduled-input requirements, and scheduler activation. A race that changes workflow state after history resolution still fails closed at that final gate.

### Security / tenant isolation

- Run-history lookup uses authenticated scope; request-body ownership fields cannot influence the selected tested version.
- Browser Profile/session identifiers, capture trace IDs, selectors, runtime variables, BYOK keys, AgentCore workload tokens, and provider/browser error text remain outside publish request authority.
- Removing caller control over workflow version reduces authenticated action authority without changing provider-neutral workflow contracts.

### Idempotency / concurrency / retry / timeout

- Publication idempotency and schedule mutation ordering remain owned by the existing lifecycle/Scheduler adapter.
- A concurrent recompile or Fresh Test between history resolution and publish cannot make an older version silently publish because the lifecycle revalidates durable automation state and the latest workflow version.
- No retry loop, queue, lease, outbox, heartbeat, or recovery subsystem is introduced.

### Side-effect verification / recovery

- This change performs no browser/model work and does not alter workflow effect verification, checkpoints, scheduled-run idempotency, human takeover/resume, or crash reconciliation.
- It only tightens which tested workflow identity the authenticated publication transport may request.

### Cost / observability

- A structurally valid Publish request performs the existing sanitized run-history read before Scheduler-backed publication. No Browser/model compute is added.
- Structurally invalid schedules stop before the history read; valid requests without successful Fresh Test provenance stop before Scheduler mutation.
- No AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact is added.

### Regression coverage

The focused provider-neutral publish-authority suite proves:

- caller-supplied workflow version cannot override a lower successful Fresh Test version;
- a numerically higher successful scheduled run cannot authorize publication;
- a failed newer Fresh Test cannot authorize publication;
- spoofed tenant/user fields cannot influence trusted scope;
- durable history with no successful Fresh Test returns `409 CONFLICT` and makes zero publish calls.

Existing request-boundary coverage additionally proves malformed schedules return `400 BAD_REQUEST` before publish. CI #277 exposed that ordering regression and the corrective commit restores it without weakening either gate.

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
5. finish capture, compile, inspect the semantic plan, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. attempt to forge both Fresh Test run ID and Publish workflow version through the authenticated API and confirm neither can choose the durable identity;
7. exercise `capture`, `cloudExecution`, and `scheduling` `NOT_CONFIGURED` states and confirm each causes zero corresponding cloud work;
8. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
9. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
