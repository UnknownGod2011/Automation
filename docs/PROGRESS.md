# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `c60b8fea1d6098bc1ca2c1dd974ffbc5daaa3e32` (`Classify create replay conflicts safely`).
- GitHub Actions CI #264 passed completely on that exact head.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed in this file before that run exists.

## This product slice — expired capture sessions no longer block restart

### Product defect and correction

The durable capture-session pointer can legitimately outlive the short-lived AgentCore Browser/Live View capability until a later capture replaces it. `CaptureRecordingControlPlaneService`, however, previously treated every durable `STARTED` session as an active product recording without checking `expiresAt`.

That created a real user dead-end after browser/session expiry. The automation detail page would continue presenting the expired session as active and suppress a replacement capture. The worst case was an expired session with `finishRequested=true`: the page intentionally suppresses Cancel while finishing, so the user could be left with neither a usable Live View nor a restart action even though the AWS capture starter already supports replacing expired durable capture claims.

The provider-neutral capture-recording boundary now validates the durable expiry before exposing or accepting commands for an active capture. At or after `expiresAt`, the product-facing state becomes `NONE`. Start/Finish commands against that stale capture fail as `NOT_FOUND`, and Cancel becomes a no-op `NONE` result. The next Open cloud capture request can therefore flow into the existing AWS starter, which already allows an expired current-capture pointer to be conditionally replaced.

Malformed durable expiry is treated as a sanitized `CONFLICT`; the service does not guess whether the capture is still valid.

### Security / tenant isolation

- Tenant/user/automation identity validation still happens before expiry classification.
- Expiry is evaluated only from server-owned durable capture metadata; no browser-supplied timestamp gains authority.
- Browser session IDs, Browser Profile references, Live View URLs, cookies, BYOK keys, workload tokens, and provider/browser error bodies remain excluded from the product-facing capture view.
- An expired Live View capability is never reconstructed or reissued from persisted data; the product starts a new isolated capture instead.

### Idempotency / concurrency / retry / timeout

- No new retry loop, lease, outbox, or recovery subsystem was added.
- The durable current-capture pointer remains the AWS concurrency authority. `AwsDynamoCaptureSessionStore.putStarted()` already permits replacement only when the stored capture expiry is at or before the new capture start time.
- A truly concurrent replacement is still serialized by that conditional DynamoDB claim; only one replacement capture can become authoritative.
- Expired Start/Finish commands are rejected before capture-control mutation or collector launch.
- Expired Cancel does not issue a stale browser-stop call. AgentCore session lifetime remains the cleanup authority for an already-expired browser; a replacement capture claims the durable slot independently.

### Side-effect verification / recovery

- Workflow execution, browser action verification, run checkpoints, scheduled retries, human-resolution claims, resume leases, heartbeat, and effect reconciliation are unchanged.
- This change affects only pre-workflow capture-session presentation/command eligibility. It does not infer a successful capture from timeout; an expired partial capture remains unusable and must be replaced.

### Cost / observability

- Users no longer need to wait for a stale durable pointer or invent another automation merely to restart capture.
- No AWS resource, table, queue, Lambda, metric dimension, IAM permission, model call, dependency, or retained GitHub Actions artifact was added.
- The expired durable session/control records may remain until normal retention/cleanup, but they cannot block product progress. Their bounded storage cost is preferable to mutating historical capture state merely for UI cleanup.

### Regression coverage

New provider-neutral tests prove:

- an expired `STARTED` capture is presented as `NONE` without reading capture-control state;
- stale Start and Finish commands fail before collector/control work;
- expired Cancel performs no durable mutation or browser cleanup;
- malformed durable expiry fails closed with a sanitized conflict.

The existing AWS capture-session tests continue to cover conditional replacement of expired current-capture pointers and cleanup of failed new-session startup.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains a draft/unmerged branch. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- An abandoned create attempt after a definitely-uncommitted metadata write may leave one retry-stable Browser Profile; blind cleanup remains unsafe under ambiguous metadata persistence.
- Expired capture records/control rows are not immediately deleted by this slice. They are non-authoritative after expiry and should be cleaned only by a deliberate retention policy if live storage volume makes that worthwhile.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. create one automation and validate same-form replay converges on one automation/Browser Profile;
4. exercise capture restart explicitly: open a capture, allow/force it to expire, confirm the product offers a replacement capture rather than remaining stuck, then complete a fresh Live View capture;
5. compile/inspect and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
7. deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
