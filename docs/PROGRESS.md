# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, durable trusted traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head for this run: `52ed8ba82cdf3a5f1403faae04f425f30ba1de65` (`Keep Fresh Test run identity server-owned`).
- GitHub Actions CI #276 completed successfully on that exact head: deterministic lock verification, frozen install, strict `pnpm check`, all production package builds, AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contracts, and the full test suite passed.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the publish-authority change below; no pass is claimed until a completed successful run exists for the new commit.

## This product slice — keep Publish workflow version server-owned at the authenticated API boundary

### Product/security defect

The Next.js product had already stopped asking the user to choose a workflow version during approval/publish, but the ordinary authenticated control-plane HTTP route still parsed `workflowVersion` from request JSON and forwarded it as publication authority.

The core publish lifecycle still validates `READY_TO_PUBLISH` and rejects a workflow version that is not the latest immutable tested version, so this was not a direct bypass. However, an end-user API should not let the caller choose an internal workflow-version identity when the durable successful Fresh Test history already determines the only legitimate publication candidate.

### Behavior

- `POST /v1/automations/:automationId/publish` no longer parses caller-supplied `workflowVersion` as authority.
- The authenticated HTTP boundary resolves run history under the trusted tenant/user scope and selects the highest workflow version whose run is both `SUCCEEDED` and classified `FRESH_TEST`.
- Successful scheduled runs and failed Fresh Tests cannot authorize publication.
- A caller-supplied `workflowVersion`, tenant ID, or user ID is ignored for publication authority.
- If there is no successful Fresh Test in durable history, Publish returns sanitized `409 CONFLICT` before `publishAutomation()` is invoked.
- `AutomationControlPlaneService.publishAutomation()` and the provider-neutral lifecycle still accept an explicit workflow version for trusted internal/local composition. This slice narrows only the ordinary end-user HTTP transport.
- The existing lifecycle remains the final authority for `READY_TO_PUBLISH`, latest immutable workflow version, scheduled-input requirements, and scheduler activation. A race that changes workflow state after history resolution still fails closed at that final gate.

### Security / tenant isolation

- Run-history lookup uses the authenticated scope; request-body ownership fields cannot influence the selected tested version.
- Browser Profile/session identifiers, capture trace IDs, selectors, runtime variables, BYOK keys, AgentCore workload tokens, and provider/browser error text remain outside the publish request authority.
- Removing caller control over workflow version reduces the authenticated action-authority surface without changing the provider-neutral workflow representation.

### Idempotency / concurrency / retry / timeout

- Publication idempotency and schedule mutation ordering remain owned by the existing lifecycle/Scheduler adapter.
- A concurrent recompile or new Fresh Test between history resolution and publish cannot make an older version silently publish: the lifecycle revalidates durable automation state and latest workflow version.
- No new retry loop, queue, lease, outbox, heartbeat, or recovery subsystem is introduced.

### Side-effect verification / recovery

- This change does not execute browser/model work and does not alter workflow effect verification, checkpoints, scheduled-run idempotency, human takeover/resume, or crash reconciliation.
- It only tightens which tested workflow identity the authenticated publication transport may request.

### Cost / observability

- Publish now performs the already-existing sanitized run-history read before the scheduler-backed publication call. This is bounded to the automation's existing run history and creates no Browser/model compute.
- Invalid publish attempts without a successful Fresh Test stop before Scheduler mutation.
- No AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact is added.

### Regression coverage

A new focused provider-neutral HTTP suite proves:

- a caller-supplied workflow version cannot override a lower successful Fresh Test version;
- a numerically higher successful scheduled run cannot authorize publication;
- a failed newer Fresh Test cannot authorize publication;
- spoofed tenant/user fields cannot influence the trusted scope;
- durable history with no successful Fresh Test returns `409 CONFLICT` and makes zero publish calls.

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
