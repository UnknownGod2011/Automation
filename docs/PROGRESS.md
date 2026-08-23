# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `f3f7d669ffbf6913ef015c2e01d7ec251ae6c497` (`Make dashboard authoring readiness truthful`).
- GitHub Actions CI #261 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — capability-aware authenticated navigation

### Product defect and correction

The dashboard and `/automations/new` page already failed closed when the authenticated control-plane endpoint was missing or unsafe. However, the global authenticated navigation still advertised **Credentials**, **Inputs**, **Notifications**, and **New automation** in that same known-unavailable deployment state. Each destination eventually failed closed, so this was not an authorization bypass, but it created a contradictory first-use experience and invited mutations the product already knew could not succeed.

The root layout now reuses the same server-side `newAutomationAccess()` readiness policy as the create page. When the authenticated control plane is configured, the normal control-plane navigation is rendered. When it is not configured, those links are replaced by an explicit **Control plane unavailable** state while **Dashboard** and **Sign out** remain available.

### Security / tenant isolation / idempotency

- This is presentation-only. Cognito authentication, tenant/user ownership, same-origin mutation checks, and API authorization remain authoritative.
- The readiness check performs no control-plane request and handles no raw credential, Browser Profile, session, workload-token, provider-error, runtime-variable, or run data.
- Hiding navigation cannot grant or revoke backend authority; direct route/API access continues to fail closed independently.
- Existing create/credential/settings idempotency semantics are unchanged.

### Concurrency / retry / timeout / verification / recovery

- No execution-plane operation, browser/model call, Scheduler mutation, retry budget, workflow verification rule, lock, human-resolution claim, lease, heartbeat, or reconciliation path changed.
- No additional recovery subsystem was introduced.

### Cost / observability

- No network request, DynamoDB read/write, AgentCore Browser/Runtime invocation, model request, queue traffic, email, metric dimension, AWS resource, IAM permission, dependency, or retained GitHub Actions artifact was added.
- The root layout only reuses local deployment configuration already available to the server process.

### Validation

- Added pure web regression coverage proving authenticated control-plane actions are visible only for a ready deployment and collapse to an explicit unavailable state otherwise.
- Exact-head CI must pass deterministic lock verification, frozen installation, strict `pnpm check`, all production packaging paths, AWS release/deployment/demo/OIDC contracts, and the complete test suite before this slice is considered green.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 is still a draft/unmerged branch. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- Browser Profile creation followed by an uncertain automation-metadata write can still require careful create-path reconciliation; cleanup must never delete a profile that may already be referenced by a durably committed automation. This remains a product-path correctness item for a later coherent slice rather than being approximated with unsafe blind cleanup.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. verify signed-out dashboard/create navigation shows Google-or-email sign-in, and an authenticated deployment without the control-plane endpoint exposes non-writable dashboard, create-page, and global-navigation states;
3. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
6. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
