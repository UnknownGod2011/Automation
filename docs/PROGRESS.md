# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `a8333ca5a45709450f938d95dd8524a9697aeaae` (`Follow human resume run outcomes`).
- GitHub Actions CI #245 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — keep capture compilation identity server-side

### Product/security defect closed

The product already removed manual trace/workflow identifiers from the user-facing Compile form, but the authenticated automation summary still exposed the latest durable `traceId`, and the Next.js server read that identifier back only to echo it into `POST /compile`. The user could not normally edit that value, but the web/control-plane boundary still carried an internal durable capture identity that the control plane already knew authoritatively.

Compile now resolves both the latest completed capture and the stable workflow identity entirely inside the trusted control plane. The browser/web layer only requests “compile this automation.”

### Changes

- `LatestCompletedCaptureView` now exposes only `completedAt`, which is sufficient for compile-readiness UX.
- The control plane still validates that a completion record contains a real trace ID internally, but it no longer serializes that ID into dashboard/automation summaries.
- `AutomationControlPlaneService.compileAutomation()` now:
  - resolves the authenticated automation under tenant/user scope;
  - loads the latest durable completed capture under that same scope;
  - rejects missing/corrupt completion state before compilation;
  - supplies the server-owned trace ID to the lifecycle compiler;
  - derives the workflow identity from the authenticated automation ID.
- `POST /v1/automations/:automationId/compile` accepts no trace/workflow authority from request JSON.
- The Next.js compile action now sends an empty command body and no longer reloads a public trace ID.

### Security / tenant isolation

- A browser or stale/tampered web request can no longer select a capture trace or workflow ID for compilation.
- Tenant/user scope remains exclusively the authenticated control-plane context; the durable capture lookup uses the same ownership scope as the automation lookup.
- Browser session IDs, Browser Profile references, capture-session IDs, trace IDs, BYOK material, workload tokens, and provider/browser errors remain outside the compile-facing browser contract.
- The trusted capture-worker ingestion/completion boundary still retains internal trace identity where it is operationally required; this change only removes that identity from the end-user control-plane view/command.

### Idempotency / concurrency / retry / verification

- The existing durable latest-completed-capture pointer remains the capture authority; no read-then-write authority or new race was introduced.
- The lifecycle compiler's existing authoring-state/version gates remain final authority against replaying an already-consumed capture or compiling while published execution is active.
- Compilation itself does not execute website side effects. Browser/model retry, execution leases, schedule idempotency, and verification behavior are unchanged.
- No retry loop or fallback is added if capture state is absent or corrupt; compilation fails closed.

### Cost / observability / user recovery

- No AWS resource, SDK dependency, table, bucket, queue, browser session, model call, metric dimension, or retained Actions artifact was added.
- Compile performs the authoritative capture-state read in the control plane rather than making the web layer obtain and echo the same identity; cloud cost is effectively unchanged.
- User recovery remains simple: finish a trusted capture first, then retry Compile. Provider/internal details remain sanitized.

### Regression coverage

Core/control-plane tests now prove:

- compile readiness exposes completion time but not the durable trace ID, Browser session ID, or Browser Profile reference;
- compilation resolves the trusted trace and stable workflow identity server-side;
- compilation fails before lifecycle work when no completed capture exists;
- spoofed `traceId`, `workflowId`, tenant, or user fields in the HTTP request cannot alter compile authority.

Exact-head GitHub Actions is authoritative. This slice is not considered validated until CI completes successfully on the final published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Workflow revision intentionally does not force-cancel an execution already admitted before disablement. The existing execution lease/immutable version keeps that run isolated; users should let or resolve an in-flight side-effecting run before teaching its replacement.
- An abandoned browser may survive until its bounded AgentCore session expiry if post-cancellation cleanup is uncertain; durable cancellation still prevents its trace/profile from becoming authoritative.
- Same-provider BYOK key rotation remains opt-in; the platform does not rotate keys to evade provider quotas/rate limits.
- Recurring secret typed workflow inputs remain unsupported by design; if the live product needs them, they require vault-backed secret references rather than ordinary automation metadata.
- DynamoDB and EventBridge Scheduler cannot be updated in one transaction; lifecycle ordering is fail-closed but reconciliation after partial infrastructure failure remains an operational concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof that an ambiguous external side effect did or did not happen.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. configure BYOK;
4. complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
