# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `77f870933a67d297b0d52bbae5f278ea5dc8bb39` (`Add editable automation notification preferences`).
- GitHub Actions CI #251 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — align BYOK settings with deployed reasoning providers

### Product contract mismatch closed

The authenticated credential settings page previously invited users to enter provider identifiers such as `google` or `anthropic`. The provider-neutral credential pool intentionally supports arbitrary provider names for future adapters, but the current production AWS execution graph has a concrete OpenAI BYOK reasoning adapter only. A normal product user could therefore store a credential that the deployed product could not actually execute.

The web product now exposes only providers backed by the deployed reasoning capability. Today that set is OpenAI. Google sign-in federation is unrelated and remains supported; this change concerns model-reasoning credentials only.

### Changes

- Added one shared web BYOK provider boundary with a closed list of deployable product providers.
- Credential creation now uses a provider selector rather than arbitrary free text.
- The authenticated server mutation reparses and validates the provider, so a tampered form cannot create unsupported provider metadata through the web product.
- Existing unsupported/legacy credential metadata remains visible for rotation/removal; no stored secret is migrated or deleted automatically.
- Provider-neutral core contracts and credential storage remain unchanged so a future Google adapter can be added without redesigning the core pool.

### Security / tenant isolation / secret handling

- Raw provider keys still cross only the authenticated server boundary and existing credential vault path; they are not returned after submission or stored in workflow/run metadata.
- Tenant/user ownership remains Cognito-derived and is not accepted from the form.
- Rejecting unsupported web providers happens before credential creation, avoiding misleading secret metadata that cannot be used by this deployment.
- No Browser Profile, session, workload token, provider error body, or secret reference was added to the page.

### Idempotency / concurrency / retry / verification

- Credential IDs remain server-generated UUIDs; duplicate/replay and metadata health behavior are unchanged.
- Credential selection remains governed by the provider-neutral configured `providerOrder`; this slice does not introduce automatic provider failover or same-provider key rotation.
- Browser/model retry, side-effect verification, schedule idempotency, automation locking, and human-resume fencing are unchanged.

### Cost / observability

- No AWS resource, SDK dependency, database/table, queue, model call, Browser session, email send, metric dimension, or retained Actions artifact was added.
- The change prevents the normal UI from creating credentials that would later lead to a fail-closed unsupported-provider execution path.

### Validation

- Added web regression coverage proving OpenAI normalization and rejecting Google, Anthropic, empty, and missing provider values at the product boundary.
- Added a regression locking the currently exposed provider option set to the deployed OpenAI capability.
- The settings page and server mutation share the same provider definition to prevent UI/server drift.
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
3. configure an OpenAI BYOK credential through the now capability-aligned settings page;
4. create a bounded automation draft, complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES, then exercise notification preferences while human-attention notification remains mandatory;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
