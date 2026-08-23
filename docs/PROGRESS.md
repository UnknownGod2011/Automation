# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `5b36eb728e55b70439d961c1db50ea4eef10c992` (`Refresh automation draft lock snapshot`).
- GitHub Actions CI #248 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — make notification preferences truthful in the product UX

### Product contract mismatch closed

The create-automation form said the failure-notification checkbox controlled both ordinary failures and runs that need human attention. The provider-neutral reporting policy intentionally does something stricter: `WAITING_FOR_HUMAN` always notifies the owner, even when `notifyOnFailure` is disabled. Existing core regression coverage explicitly enforces that behavior so authentication repair or another required human action cannot silently sit unnoticed.

The UX now states the actual policy instead of implying that a user can disable attention notifications.

### Changes

- Added a small shared web product-copy helper for notification preferences.
- The failure checkbox now says only that it controls ordinary run failures.
- The success checkbox continues to control optional completion notifications.
- The create page now explicitly states that human-attention pauses always notify the owner.
- Added a web regression test locking this distinction so future copy changes cannot silently contradict the reporting contract.

### Security / tenant isolation / recovery

- No ownership, recipient routing, Cognito identity, SES transport, execution, checkpoint, or recovery authority changed.
- Human-attention notification remains mandatory and tenant/user scoped through the existing trusted notification resolver.
- No provider error, browser state, credential, session identifier, or secret was added to the UI.

### Idempotency / concurrency / retry / verification

- Notification delivery semantics are unchanged: duplicate scheduled delivery remains suppressed by the existing run/idempotency authority and human-resume reporting remains limited to newly executed outcomes.
- Browser/model retries, side-effect verification, automation locking, and human-resume claim/lease fencing are unchanged.

### Cost / observability

- No AWS resource, SDK dependency, table, queue, browser session, model call, metric dimension, or retained GitHub Actions artifact was added.
- This is a product-contract clarification only; it does not increase SES volume because the mandatory attention behavior already existed.

### Validation

- Added `apps/web/lib/notification-preferences.test.ts` covering the ordinary-failure opt-out versus mandatory attention distinction.
- Exact-head GitHub Actions remains authoritative; this slice is not considered complete until CI succeeds on the published head.

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
4. create a bounded automation draft, complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
