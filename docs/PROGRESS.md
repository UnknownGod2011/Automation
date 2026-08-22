# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `b8523b26a5d84d95e3e4a8aa06f5d82b10b053cd` (`Align workflow revision regression coverage`).
- GitHub Actions CI #243 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — align capture controls with the safe workflow-revision lifecycle

### Product defect closed

The server-side authoring boundary already correctly requires a published automation to be disabled before a replacement workflow can be captured, and it already prevents a second authoritative capture while one is active. The automation detail page did not reflect those rules: it rendered **Open cloud capture** even while a durable capture was already active and while lifecycle states such as `ACTIVE`, `PAUSED`, `RUNNING`, or human-attention states would intentionally reject capture.

That mismatch was safe at the backend but poor product behavior: the UI invited requests the product was designed to refuse, obscuring the newly added disable → revise → retest → republish flow.

### Changes

- Added `captureLaunchPresentation()` in the web boundary.
- The helper delegates authoring eligibility to the provider-neutral `canAuthorWorkflowCapture()` policy rather than duplicating a second list of allowed states.
- An existing active capture always suppresses a second launch button and keeps the user on continue/cancel controls for the authoritative session.
- `ACTIVE` and `PAUSED` published automations now explain that explicit Disable is required before teaching a replacement workflow; Pause alone does not reopen authoring.
- `RUNNING` and human-attention states now explain that the current execution/recovery state must be resolved before revision.
- `DISABLED` explicitly tells the user that the automation is safe to revise and exposes the capture launch action.
- Overlapping `CAPTURING`/`TESTING` lifecycle phases remain blocked from starting another capture.
- No execution-plane, scheduling, recovery, persistence, IAM, browser, or model behavior changed.

### Security / tenant isolation

- This is a presentation boundary only; authenticated tenant/user ownership continues to come from the control plane.
- Browser session IDs, Browser Profile references, Live View capability material, BYOK secrets, workload tokens, workflow selectors, and internal execution identities remain server-side.
- The UI does not become an authorization authority: the existing core lifecycle policy and AWS capture preflight remain the final guards against stale/tampered requests.

### Idempotency / concurrency / retry / verification

- Duplicate capture protection remains durable in the existing capture-session/current-capture authority.
- Suppressing the second launch button reduces avoidable duplicate Browser allocation attempts but does not replace the backend conditional-write protection.
- The safe revision ordering remains unchanged: a published automation must become durably `DISABLED` before capture is eligible, and stale Scheduler deliveries remain rejected by execution preflight.
- Existing bounded retries, immutable workflow versions, side-effect verification, run leases, and human-recovery semantics are unchanged.

### Cost / observability / recovery

- Sequential duplicate capture clicks are no longer encouraged while an active capture exists, reducing unnecessary rejected control-plane calls and potential short-lived Browser allocation races.
- No new AWS resource, SDK dependency, table, queue, metric dimension, retained CI artifact, or model/browser execution path was added.
- User recovery remains explicit: continue/cancel the active capture, resolve an in-flight/attention state, or disable the published automation before revision.

### Regression coverage

Web tests now prove:

- `DRAFT`, `READY_TO_PUBLISH`, and `DISABLED` expose capture launch through the same core authoring policy;
- an active durable capture suppresses another launch even when the automation status itself is authoring-eligible;
- `ACTIVE` and `PAUSED` require Disable before workflow revision;
- `RUNNING`, `NEEDS_AUTH`, `NEEDS_API_KEY`, and `NEEDS_ATTENTION` remain blocked;
- overlapping capture/test lifecycle phases remain blocked;
- existing server-resolved recording/finish identities retain their replay-safe behavior.

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
4. start one Live View capture and confirm a second capture launch is not offered while it is active; optionally verify Cancel capture & start over;
5. complete capture, compile, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows its durable result;
6. verify correction before first publish from `READY_TO_PUBLISH`;
7. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
8. confirm published `ACTIVE`/`PAUSED` state does not offer capture, then Disable and verify capture becomes available for revision;
9. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
10. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
