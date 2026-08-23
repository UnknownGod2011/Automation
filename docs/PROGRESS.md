# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `2683842a2dce96b9afe57a6a419da7f64eb4e54f` (`Gate automation authoring on web authentication`).
- GitHub Actions CI #258 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — gate automation authoring on control-plane readiness

### Product defect and correction

The create-automation page already hid its form when Cognito authentication was missing or the visitor was signed out. However, an authenticated deployment with Cognito configured but no valid `AUTOMATION_CONTROL_PLANE_URL` still rendered the complete authoring form. The dashboard simultaneously reported that mutations were disabled, so a user could enter website/objective/consent metadata only to discover after submission that no control plane existed to persist the draft.

The create-page presentation gate now requires both an authenticated web session and a valid configured control-plane endpoint before rendering writable automation metadata fields. Authentication-not-configured and control-plane-not-configured are distinct non-writable product states. The control-plane readiness check reuses the existing `WebControlPlaneClient.status()` URL policy and performs no network request.

### Security / tenant isolation / secret handling

- This remains a presentation/readiness gate, not an authorization authority. The POST route and control plane continue to enforce Cognito-derived tenant/user scope.
- A deployment that cannot persist automation metadata no longer invites the user to enter target URLs, objectives, consent choices, or notification preferences.
- Control-plane URL validation retains the existing HTTPS requirement for remote endpoints and localhost exception for local development.
- The readiness helper uses a synthetic non-secret bearer value only to exercise existing local `status()` validation; it never issues a request and never handles a real access token, Browser Profile identifier, provider secret, or workload token.

### Idempotency / concurrency / retry / verification / recovery

- No run creation, schedule mutation, Browser/model execution, workflow graph, retry budget, side-effect verification, checkpoint, human-resolution claim, or recovery behavior changed.
- Deployment configuration can change after render. The authenticated POST/client boundary remains authoritative and still fails closed if the control plane becomes unavailable concurrently.

### Cost / availability / observability

- The additional readiness decision is process-local configuration validation only. It adds no DynamoDB/S3/AgentCore/Scheduler/model call and no cloud cost.
- No dependency, AWS resource, IAM permission, queue, metric dimension, email, or retained GitHub Actions artifact was added.

### Validation

- Extended `new-automation-access` regression coverage for authenticated + configured readiness, signed-out behavior, separate auth-vs-control-plane configuration states, and rejection of an unsafe remote HTTP control-plane URL.
- Exact-head CI must pass deterministic lock verification, frozen installation, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the complete test suite before this slice is considered green.

## Known production risks intentionally left visible

- Page-level readiness is not authorization and does not prove the remote control plane is healthy; mutations must continue to fail closed on request/network failure.
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
2. verify signed-out direct navigation to `/automations/new` shows sign-in and an authenticated deployment without the control-plane URL shows a non-writable configuration state;
3. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
6. observe Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
