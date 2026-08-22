# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `c154ea59d47b265303b35116e2bcd9e679df786b` (`Align capture controls with revision lifecycle`).
- GitHub Actions CI #244 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — automatically follow durable run state after resume/repair

### Product defect closed

Human continuation and target-auth repair already execute asynchronously through AgentCore Runtime, but the run diagnostics page still told the user to manually refresh after `Continue workflow` or `Save repaired session & resume`. That made the final bounded-failure → human-repair → successful-resume lifecycle feel incomplete even though the durable execution machinery was already correct.

### Changes

- Added a small web-only run-status polling policy with a 5-second cadence and a hard 5-minute maximum window.
- Active durable run states (`QUEUED`, `PREFLIGHT`, `RUNNING`, `RETRYING`) are followed automatically.
- A `WAITING_FOR_HUMAN` run is polled only after a trusted `resume-submitted` or `takeover-finished` server notice. Ordinary paused runs do not create background polling traffic.
- Terminal states (`SUCCEEDED`, `FAILED`, `CANCELED`, `SKIPPED`) stop polling immediately even if the original success notice remains in the URL.
- Added a client `RunStatusPoller` that refreshes only the current server-rendered run view; it does not call execution, browser, model, evidence, or recovery APIs directly.
- Updated run diagnostics copy so successful resume/repair submission explains that the page will follow durable state automatically rather than asking for manual refresh.

### Security / tenant isolation

- Polling only refreshes the already-authenticated run page. The browser receives no tenant/user authority, workflow node ID, resolution ID, Browser Profile reference, session ID, BYOK credential, workload token, evidence reference, or provider/browser error detail.
- The authenticated server and control plane continue to re-resolve tenant/user/run ownership on every refresh.
- The poller is presentation-only and cannot create a run, claim a resolution, acquire a lease, start browser/model work, or mutate durable state.

### Idempotency / concurrency / retry / timeout / verification

- Existing human-resolution claim IDs, execution leases, heartbeat fencing, immutable workflow versions, bounded workflow retries, and side-effect verification remain the execution authority.
- Refreshing diagnostics is read-only and does not redeliver the resume/takeover POST command.
- The polling window is bounded to 60 attempts at 5 seconds each (5 minutes), preventing an unbounded browser refresh loop if Runtime remains slow or unavailable.
- A run that pauses again stops automatic polling unless a new trusted resume/repair submission occurs.

### Cost / observability / recovery

- The only added cost is bounded authenticated control-plane read traffic while a run is actively progressing after user intervention.
- No new AWS resource, SDK dependency, DynamoDB record, queue, model call, browser session, metric dimension, retained Actions artifact, or recovery subsystem was added.
- The change improves the user recovery loop by making the terminal result visible automatically after a successful human action.

### Regression coverage

Web tests now prove:

- active execution states poll;
- an untouched `WAITING_FOR_HUMAN` run does not poll;
- a paused run polls after a trusted resume or takeover-completion submission;
- failed resume/takeover notices do not poll;
- terminal states stop polling even when the original submission notice is still present;
- the polling window remains exactly bounded to five minutes.

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
4. complete Live View capture, compile, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm this diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
