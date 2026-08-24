# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, durable trusted traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head for this run: `efd90ae226eb160efc030ba54d12d677c96e99f1` (`Make automation creation retries converge`).
- GitHub Actions CI #274 completed successfully on that exact head: deterministic lock verification, frozen install, strict `pnpm check`, all production package builds, AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contracts, and the full test suite passed.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the capture-transport change below; no pass is claimed until a completed successful run exists for the new commit.

## This product slice — keep capture trace ingestion behind the trusted worker boundary

### Product/security defect

The ordinary Cognito-authenticated `AutomationControlPlaneHttpHandler` still exposed `POST /v1/automations/:automationId/capture-trace`. That route accepted a caller-supplied `CaptureTrace` and forwarded it directly to lifecycle capture persistence.

Production capture already has a separate trusted completion boundary whose ordering is Browser Profile save -> immutable trace persistence -> durable capture completion. Its handler requires deployment-authenticated capture-worker context, and the AWS deployment exposes that boundary separately through IAM authorization. Leaving raw trace ingestion on the end-user API undermined that separation: a normal signed-in user could inject capture material without proving it came from the active AgentCore capture session or that the Browser Profile was saved first.

### Behavior

- The ordinary authenticated control-plane HTTP router no longer exposes a `capture-trace` route.
- A `POST /v1/automations/:automationId/capture-trace` request now falls through to the normal sanitized 404 response and performs zero capture-persistence work.
- The provider-neutral lifecycle/service method remains available for deterministic local/mock/internal composition; this slice narrows only the end-user HTTP transport authority.
- Production capture completion remains owned by `TrustedCaptureCompletionHandler` and its deployment-authenticated worker context.
- Compilation continues to resolve only the latest durable completed capture server-side. The browser supplies neither trace ID nor workflow ID.

### Security / tenant isolation

- Cognito authentication proves user identity, but it is no longer sufficient authority to manufacture a capture trace or mark teaching evidence acceptable.
- The trusted completion path continues to validate tenant/user/automation/session/Profile/trace identity before completion.
- Browser session IDs, Browser Profile references, trace IDs, BYOK secrets, workload tokens, and raw provider/browser errors remain server-side.
- Removing the public route reduces the action-authority surface presented to an authenticated but potentially malicious client.

### Idempotency / concurrency / retry / timeout

- Existing capture-session claims, create-only/conditional persistence, same-trace replay behavior, and strongly consistent contention reads remain authoritative.
- No new retry loop, queue, lease, outbox, heartbeat, or recovery subsystem is introduced.
- Public rejected requests stop before S3/DynamoDB trace persistence, Browser Profile mutation, Browser allocation, model work, or compile work.

### Side-effect verification / recovery

- Workflow compilation, deterministic/semantic execution, effect verification, checkpoints, human takeover/resume, and crash reconciliation are unchanged.
- This change protects the provenance of the capture evidence from which those immutable workflows are compiled.

### Cost / observability

- Forged/legacy public trace-ingestion calls now cost only the normal authenticated API request and do not create trace-storage writes.
- No AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact is added.

### Regression coverage

- A new provider-neutral HTTP regression proves the former `capture-trace` path returns sanitized `404 NOT_FOUND`.
- The same regression proves `AutomationLifecyclePort.persistCapture()` receives zero calls from that public request.
- Existing trusted capture-completion tests continue to cover worker authentication, profile-before-trace ordering, durable completion, replay, tenant isolation, and sanitized failures.

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
6. exercise `capture`, `cloudExecution`, and `scheduling` `NOT_CONFIGURED` states and confirm each causes zero corresponding cloud work;
7. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
