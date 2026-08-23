# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `cfb332a27aa135019bf1cf4155ab7056a6cb6b49` (`Surface Fresh Test credential readiness`).
- GitHub Actions CI #257 passed completely on that exact head, including deterministic lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — require authentication before automation authoring UI

### Product defect and correction

The create-automation POST boundary already requires an authenticated Cognito-derived session, but `/automations/new` itself rendered a writable-looking form for direct signed-out navigation. That made the product state misleading: a visitor could enter target URL, objective, consent, and notification choices only to discover authentication was required after submission.

The create page now resolves the same server-side web-auth status used by the rest of the product before rendering authoring controls. `SIGNED_OUT` receives an explicit sign-in action with a bounded return path to `/automations/new`; `NOT_CONFIGURED` receives a non-writable deployment state; only `AUTHENTICATED` renders the automation metadata form.

### Security / tenant isolation / secret handling

- This is a presentation/authentication gate, not a new authorization authority. The existing authenticated mutation and control-plane tenant/user checks remain mandatory and unchanged.
- Signed-out users no longer receive a form that invites them to enter durable website/objective metadata before authentication.
- No target-site credential, Browser Profile identifier, provider secret, workload token, tenant ID, or user ID is added to browser state.
- The sign-in return path is fixed to the local product route rather than supplied from user-controlled form data.

### Idempotency / concurrency / retry / verification / recovery

- No run creation, schedule mutation, browser/model execution, retry budget, verification contract, workflow graph, checkpoint, human-resolution claim, or recovery behavior changed.
- Authentication state can still expire after render; the POST boundary remains authoritative and fails closed if the session changes concurrently.

### Cost / availability / observability

- The page performs only the existing server-side Cognito configuration/cookie-presence check. It does not call AgentCore, DynamoDB, S3, Scheduler, model APIs, or the control plane merely to display the form.
- No dependency, AWS resource, IAM permission, queue, metric dimension, email, or retained Actions artifact was added.

### Validation

- Added pure regression coverage proving the create form is reachable only from `AUTHENTICATED`, while `SIGNED_OUT` and `NOT_CONFIGURED` map to non-authoring states.
- The page now mirrors the authenticated UX already used by credential settings and automation-detail pages.
- Exact-head CI must pass deterministic lock verification, frozen install, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the full test suite before this slice is considered green.

## Known production risks intentionally left visible

- The page-level authentication check is not authorization; all mutations must continue to enforce trusted Cognito-derived ownership server-side.
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
2. verify signed-out direct navigation to `/automations/new` shows sign-in rather than the authoring form, then sign in through Cognito/Google;
3. verify the trusted notification identity and configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
6. observe Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
