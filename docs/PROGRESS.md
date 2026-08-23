# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `a74100b3fa961287a46cd0fa4667a6e4599508c8` (`Align BYOK settings with deployed provider`).
- GitHub Actions CI #252 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — make retained revision schedules truthful in the dashboard

### Product-state mismatch closed

The safe published-workflow revision path intentionally preserves the previous `schedule` and `publishedWorkflowVersion` while requiring the user to Disable the automation before recapturing and testing a replacement. EventBridge Scheduler therefore remains disabled throughout revision authoring until the replacement is explicitly republished.

The dashboard's next-run projection previously looked only at the retained schedule plus published version and special-cased literal `PAUSED`/`DISABLED`. Once a disabled automation advanced into `CAPTURING`, `COMPILING`, `READY_TO_TEST`, `TESTING`, or `READY_TO_PUBLISH`, it could therefore display a future "Next run" timestamp even though Scheduler was still disabled. That was a user-facing correctness defect in the revision lifecycle.

### Changes

- Added one explicit retained-disabled-revision schedule predicate to the web view model.
- A previously published automation in capture/compile/test/pre-publish revision states now reports `Next run: disabled during workflow revision` instead of calculating an occurrence that cannot run.
- The retained schedule remains visible for context, but its label is annotated `disabled during revision` so the old recurrence cannot be mistaken for an active Scheduler resource.
- Initial unpublished authoring remains `Next run: not scheduled`; the revision rule requires both a retained published workflow version and schedule.
- Once the revised workflow is republished and durable state returns to `ACTIVE`, normal daily/weekly/hourly next-run projection resumes.

### Security / tenant isolation / execution authority

- This is a presentation-only correction. Tenant/user ownership, Cognito authentication, workflow immutability, Scheduler mutation authority, run admission, Browser Profiles, BYOK credentials, and AgentCore workload identity are unchanged.
- No browser request, provider secret, workflow variable, internal node identifier, or scheduling credential is added to the UI.
- The server-side lifecycle remains authoritative: published revision authoring is possible only after the existing fail-closed Disable transition has made durable state non-executable before Scheduler disablement.

### Idempotency / concurrency / retry / verification / recovery

- No new mutation, retry, lease, outbox, reconciliation, or recovery mechanism was introduced.
- Existing EventBridge occurrence idempotency, automation execution leases, checkpoint semantics, side-effect verification, and human-resume fencing are unchanged.
- A stale browser page may still display an old snapshot until refreshed; it cannot re-enable Scheduler or create execution authority through this view-model change.

### Cost / observability

- No AWS resource, SDK dependency, DynamoDB read/write, Scheduler API call, model token, Browser session, email send, metric dimension, or retained GitHub Actions artifact was added.
- The change prevents a misleading next-run promise during revision without introducing a second source of schedule truth.

### Validation

- Added regression coverage for `CAPTURING`, `COMPILING`, `READY_TO_TEST`, `TESTING`, and `READY_TO_PUBLISH` with retained published schedule metadata, proving none advertises a future occurrence.
- Added coverage proving the retained schedule is visibly marked disabled during revision.
- Added coverage proving an `ACTIVE` republished automation resumes normal next-run preview and an initial unpublished authoring flow remains unscheduled.
- Exact-head GitHub Actions remains authoritative; this slice is not green until its PR-head CI run succeeds.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today. The core remains provider-neutral, but additional providers must not be advertised until their adapter, failure classification, timeouts, tests, and deployment configuration exist.
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
3. configure an OpenAI BYOK credential through the capability-aligned settings page;
4. create a bounded automation draft, complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the dashboard shows a truthful next occurrence;
6. exercise the safe revision loop: Disable → Capture replacement → Compile → Fresh Test, verify the retained schedule is visibly disabled throughout revision, then republish and confirm next-run projection resumes;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES, then exercise notification preferences while human-attention notification remains mandatory;
8. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
