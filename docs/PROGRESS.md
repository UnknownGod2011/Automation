# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `c7f86b8a976f73d1b7dde3fe6212d1f9a65e7d7c` (`Gate automation authoring on control-plane readiness`).
- GitHub Actions CI #259 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — edit reusable scheduled inputs without reteaching

### Product defect and correction

Privacy-preserving capture replaces typed workflow values with synthetic `capture_input_N` bindings. The product could collect explicit non-secret values for those bindings at initial publish, but after activation there was no supported way to change a harmless reusable value without disabling the automation, recording a replacement workflow, recompiling, retesting, and republishing even when the immutable workflow itself had not changed.

The authenticated control plane now supports a bounded write-only scheduled-input update for `ACTIVE` and `PAUSED` published automations. The replacement payload must contain exactly the same key set that was already validated when the workflow was published. This means the settings path can change values but cannot manufacture a new workflow binding or broaden execution authority.

A new authenticated Next.js **Inputs** settings page lists only live/paused automations whose sanitized immutable workflow inspection exposes unresolved capture inputs. Existing values are never returned to the browser. The user supplies the complete replacement JSON and explicitly acknowledges that every value is non-secret.

### Security / tenant isolation / secret handling

- Tenant/user ownership comes exclusively from the authenticated control-plane scope. Request-body `tenantId` or `userId` fields have no authority.
- The update API never returns `scheduledNonSecretInputs`; automation summaries remain value-redacted.
- Browser Profile references, AgentCore session IDs, BYOK secret references, workload tokens, checkpoint variables, and provider/browser errors remain outside this settings surface.
- The key set is closed to the already-published record. Extra, missing, or substituted keys fail before persistence.
- Values retain the existing ceilings: at most 64 values, 4,096 characters per value, and 32,768 aggregate characters.
- Explicit non-secret acknowledgement is mandatory on every update. Authentication secrets remain intentionally unsupported here and belong in Browser Profile or vault-backed credential boundaries.

### Idempotency / concurrency / retry / verification / recovery

- Exact same-value submissions are idempotent and avoid a persistence write.
- DynamoDB record replacement is atomic at the single automation-record boundary. A scheduled occurrence racing the update reads either the complete old set or the complete new set; there is no partial per-key state.
- A run already admitted before the update keeps the variables in its durable checkpoint. The new defaults apply to later admitted runs.
- No EventBridge Scheduler mutation is required because recurrence/timezone and immutable workflow authority do not change.
- No Browser/model execution, retry budget, side-effect verification, human-resolution claim, lease, heartbeat, or crash-reconciliation behavior changed.
- The broader automation-record read/modify/write lost-update risk remains the same as other control-plane settings mutations; this slice does not add a narrow CAS subsystem absent live evidence that it is needed.

### Cost / availability / observability

- The settings page performs the existing authenticated dashboard read plus workflow-inspection reads for ACTIVE/PAUSED candidates. It starts no AgentCore Browser, model call, Step Functions execution, or Scheduler operation.
- An update is one existing automation-record write plus the normal sanitized summary reads.
- No dependency, AWS resource, IAM permission, queue, metric dimension, email, or retained GitHub Actions artifact was added.

### Validation

- Added provider-neutral regression coverage for ACTIVE replacement, PAUSED replacement, exact-key enforcement, mandatory acknowledgement, authoring-state rejection, ownership isolation, HTTP spoof suppression, response redaction, and size limits.
- The production web path reuses the existing scheduled-input parser and same-origin authenticated mutation boundary.
- Exact-head CI must pass deterministic lock verification, frozen installation, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the complete test suite before this slice is considered green.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 is still a draft/unmerged branch. The real protected deployment should follow a deliberate reviewed promotion/merge rather than weakening the OIDC branch trust boundary merely to run the demo.
- Page-level readiness is not authorization and does not prove the remote control plane is healthy; mutations must continue to fail closed on request/network failure.
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
2. verify signed-out direct navigation to `/automations/new` shows sign-in and an authenticated deployment without the control-plane URL shows a non-writable configuration state;
3. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and explicitly non-secret recurring inputs, then change one reusable value from **Inputs** and verify the next admitted occurrence uses the replacement without workflow republish;
6. observe Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
