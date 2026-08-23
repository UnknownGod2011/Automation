# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `170ae332537c7c191ab3983bdff76a21ce3a7022` (`Allow editing reusable scheduled inputs`).
- GitHub Actions CI #260 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — truthful dashboard authoring availability

### Product defect and correction

The authenticated dashboard already knew when `AUTOMATION_CONTROL_PLANE_URL` was unavailable: it rendered all control-plane capabilities as `NOT_CONFIGURED` and explicitly said mutations were disabled. However, the same screen still rendered an active **Create automation** link. The destination page correctly failed closed, so this was not an authorization bypass, but it invited a user into an operation the product already knew could not succeed.

The dashboard now derives one explicit create-action presentation from the existing control-plane readiness state. A configured deployment shows the normal **Create automation** action; an unconfigured deployment shows a non-writable **Creation unavailable** state and explains that the authenticated control plane must be connected first. The create page and server mutation remain independently authoritative.

The signed-out dashboard also now says **Sign in with Google or email** rather than exposing the Cognito implementation name. Cognito remains the authentication boundary; the product copy now reflects the actual native-email / optional-Google user experience.

### Security / tenant isolation / idempotency

- This is presentation-only. Authentication, tenant/user ownership, request authorization, same-origin mutation checks, and the control-plane create boundary are unchanged.
- No user-supplied ownership identifier, Browser Profile reference, session identifier, credential reference, API key, workload token, or provider error is added to the dashboard state.
- The dashboard readiness helper cannot authorize a mutation. It only decides whether to render a link or a disabled presentation state.
- Duplicate creation/idempotency behavior remains owned by the existing control-plane lifecycle and persistence boundary.

### Concurrency / retry / timeout / verification / recovery

- No execution-plane operation, retry budget, timeout, workflow verification rule, run lock, human-resolution claim, lease, heartbeat, or reconciliation path changed.
- No browser or model work can be started by this presentation helper.

### Cost / observability

- The change adds no network request, DynamoDB read/write, AgentCore Browser/Runtime call, model request, Scheduler operation, queue traffic, metric dimension, email, AWS resource, IAM permission, dependency, or retained GitHub Actions artifact.
- The dashboard reuses the control-plane readiness value it already computes.

### Validation

- Added web regression coverage proving the dashboard create action is available only when the authenticated control-plane endpoint is configured and otherwise resolves to a non-writable state.
- Exact-head CI must pass deterministic lock verification, frozen installation, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the complete test suite before this slice is considered green.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 is still a draft/unmerged branch. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. verify signed-out dashboard/create navigation shows Google-or-email sign-in, while an authenticated deployment without the control-plane endpoint exposes a non-writable creation state;
3. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and explicitly non-secret recurring inputs, then change one reusable value from **Inputs** and verify the next admitted occurrence uses the replacement without workflow republish;
6. observe Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
