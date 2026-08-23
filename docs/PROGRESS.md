# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `8addca51713f3a65cab95d8ba1e8e0adebc61807` (`Align authenticated navigation with control-plane readiness`).
- GitHub Actions CI #262 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — replay-safe automation creation

### Product defect and correction

Automation creation had a real cloud-side ambiguity at the first durable resource boundary. A Create Automation POST generated a new automation ID on every submission, while `AutomationProductLifecycleService.createDraft()` allocated the Browser Profile before the automation metadata write. If the metadata write committed but its acknowledgement was lost, the web retry generated another automation ID and could allocate another Browser Profile. Two concurrent same-ID lifecycle calls could also both pass the pre-read and allocate before either metadata write became visible.

The web form now receives one server-generated UUIDv4 creation-attempt ID when it is rendered. That non-secret idempotency identity is preserved across ordinary request failure, sign-in, and NOT_CONFIGURED redirects, so a retry submits the same automation ID rather than manufacturing another resource identity. A same-scope control-plane conflict therefore converges the browser to the existing automation instead of asking the user to create another draft.

The provider-neutral lifecycle now reuses the existing durable `AutomationLockManager` before Browser Profile allocation. It rechecks automation existence after acquiring the lock, so concurrent delivery of one creation attempt cannot allocate two authoritative profiles. If the automation metadata write throws, the lifecycle performs an authoritative repository read. When that read proves the exact same automation/profile identity was durably committed, the lost acknowledgement is treated as success. If the read is absent or uncertain, the original failure propagates and the Browser Profile is deliberately not blindly deleted because the metadata write may have committed.

The AWS Browser Profile adapter already gives retries for the same tenant/user + automation ID a stable AgentCore client token, so a later retry after a definitely-uncommitted metadata write converges on the same managed Browser Profile rather than intentionally creating another one.

### Security / tenant isolation / idempotency

- The creation-attempt UUID is browser-visible idempotency data, not an authentication or ownership credential. Cognito-derived tenant/user scope remains authoritative at the control plane and lifecycle.
- The web accepts only UUIDv4-shaped creation identities. A tampered ID can at most name an automation inside the already-authenticated ownership scope; it cannot choose another tenant/user or Browser Profile reference.
- Existing metadata bounds, consent validation, and public-target/SSRF policy still run before Browser Profile allocation.
- The creation lock is scoped through the same tenant/user + automation identity boundary as production execution locks.
- A same-attempt duplicate that arrives after the first durable commit converges to the existing automation. Two separately rendered forms intentionally receive different IDs and remain separate user creation attempts.

### Concurrency / retry / timeout / verification / recovery

- Same-ID creation is serialized before the Browser Profile side effect. The lifecycle rechecks the automation after lock acquisition to close the pre-read race.
- No new blind retry loop or recovery subsystem was added. HTTP/user replay reuses the same stable creation identity; a stale creation lock expires according to the existing bounded automation-lock TTL.
- Metadata-write uncertainty is reconciled by read-after-error. An uncertain reconciliation read never authorizes profile deletion or fabricates success.
- Workflow execution, Browser action retries, verification, scheduling, human-resolution claims, resume leases, heartbeat, and effect reconciliation are unchanged.

### Cost / observability

- Sequential or concurrent replay of one create-form attempt no longer intentionally allocates another Browser Profile.
- The change adds no table, queue, Lambda, model call, metric dimension, IAM permission, dependency, or retained GitHub Actions artifact.
- A metadata write that definitely did not commit and is then abandoned without retry can still leave one managed Browser Profile. That bounded orphan is safer than deleting a profile that might already be referenced by committed automation metadata; a future cleanup policy should be driven by observed live cost rather than speculative recovery machinery.
- No secret, Browser Profile payload, provider key, workload token, or raw provider error is added to logs or user-visible state.

### Validation

- Core regression coverage simulates a metadata write that commits and then loses its acknowledgement, proving the lifecycle returns the committed draft and does not delete its Browser Profile.
- Core concurrency coverage blocks the first profile allocation and proves a concurrent same-ID creation attempt is rejected before a second profile can be allocated.
- Web regression coverage validates the UUIDv4 creation-attempt contract and fail-closed malformed identity handling.
- Existing AWS Browser Profile coverage already proves repeated `create()` calls for the same scope + automation ID use the same AgentCore client token and opaque profile reference.
- Exact-head CI must pass deterministic lock verification, frozen installation, strict `pnpm check`, all production packaging paths, AWS release/deployment/demo/OIDC contracts, and the complete test suite before this slice is considered green.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains a draft/unmerged branch. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- An abandoned create attempt after a definitely-uncommitted metadata write may leave one retry-stable Browser Profile; do not add blind cleanup that could delete a profile referenced by an ambiguously committed automation.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. exercise Create Automation with one normal submission plus one intentionally repeated same-form submission and confirm it converges on one draft/Browser Profile;
4. complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
6. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
