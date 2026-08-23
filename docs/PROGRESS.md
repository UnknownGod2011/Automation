# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `a9004a05f051be70910b97f117c64569fa4c8050` (`Show disabled schedule during workflow revision`).
- GitHub Actions CI #253 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — distinguish test runs from production runs on the dashboard

### Product ambiguity closed

The dashboard already showed the latest run status and timestamp, but it did not identify whether that run was a Fresh Test or a scheduled production occurrence. Because Fresh Tests and scheduled runs share the same durable run summary contract, the latest test result could therefore look like evidence that the published schedule had actually executed.

The dashboard now renders a bounded presentation derived from the existing trusted run summary: `Fresh test`, `Scheduled run`, or `Run`, plus the existing sanitized user-facing status detail. A successful Fresh Test is visibly different from a successful scheduled occurrence; human-attention states show only the classified failure code already allowed by the run-history boundary.

### Security / tenant isolation / authority

- This is presentation-only. Cognito tenant/user ownership, run persistence, Scheduler authority, execution leases, Browser Profiles, BYOK credentials, AgentCore workload identity, and human-resume authority are unchanged.
- Durable run IDs and node IDs are not copied into the presentation helper or rendered as dashboard labels.
- Raw browser/provider error text, evidence contents, runtime variables, cookies, Browser/Profile identifiers, and credentials remain excluded.

### Idempotency / concurrency / retry / verification / recovery

- No new mutation, retry, lease, outbox, queue, browser/model call, verification rule, or recovery mechanism was introduced.
- The dashboard remains a snapshot of durable state; stale UI cannot create run or scheduling authority.

### Cost / observability

- No AWS resource, SDK dependency, DynamoDB read/write, Scheduler API call, Browser session, model token, email send, metric dimension, or retained GitHub Actions artifact was added.
- The page reuses the run summary it already receives from the control plane, so there is no additional cloud read.

### Validation

- Added regression coverage proving Fresh Tests and scheduled production runs receive distinct dashboard labels.
- Added coverage proving human-attention presentation contains the classified failure code but not durable run/node identifiers.
- Existing view-model tests continue to cover sanitized status details and run-kind classification independently.
- Exact-head GitHub Actions remains authoritative; this slice is not green until its PR-head CI run succeeds.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. configure an OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. confirm the dashboard clearly identifies that result as a Fresh Test rather than a scheduled production occurrence;
6. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution and confirm the dashboard now identifies the latest result as a Scheduled run;
8. inspect verification/history/CloudWatch/SES, then deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
