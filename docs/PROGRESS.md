# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `2d540488d8feed6bdc1acea39309bca283f7feda` (`Align Fresh Test input UX with workflow requirements`).
- GitHub Actions CI #240 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — fence workflow authoring from published execution

### Product correctness defect found

Capture persistence and workflow compilation previously trusted trace/workflow ownership but did not validate the automation lifecycle state. A published `ACTIVE` automation could therefore accept another completed capture, become `COMPILING`, compile an immutable replacement graph, and become `READY_TO_TEST` while its existing EventBridge schedule remained live. Compilation could also be repeated from `READY_TO_TEST` without a newly accepted capture, manufacturing additional immutable versions from already-consumed authoring evidence.

That is an unsafe product boundary rather than a recovery edge case: durable control-plane state could stop describing the still-configured production schedule, and a user could accidentally begin editing a live automation without an explicit revision workflow.

### Changes

- Added the provider-neutral `canAuthorWorkflowCapture()` policy.
- Workflow capture is currently allowed only in the non-published authoring states `DRAFT`, `COMPILING`, and `READY_TO_TEST`.
- `persistCapture()` revalidates that policy before immutable trace persistence or automation-state mutation.
- `compile()` now requires the durable automation to be exactly `COMPILING`, making each immutable compile consume a newly accepted capture boundary instead of permitting repeated compilation from `READY_TO_TEST` or published states.
- The AWS `AgentCoreCaptureSessionStarter` applies the same policy before Browser allocation, Live View signing, profile parsing, or durable capture-session creation. Published/running/paused/human-attention automations therefore do not spend AgentCore Browser compute merely to fail later.
- `READY_TO_PUBLISH` is deliberately not editable through Capture in this slice. A future “revise published/tested workflow” feature must be explicit and coordinate schedule state and any in-flight execution instead of relying on accidental state mutation.

### Security / tenant isolation

- Tenant/user ownership checks remain unchanged and occur independently from the new lifecycle-state policy.
- The AWS capture gate runs after ownership validation but before any AgentCore allocation or signed Live View capability is produced.
- No new identifiers, Browser Profile references, session capabilities, BYOK material, workflow inputs, or secrets are exposed.
- The policy is provider-neutral in core; AWS merely consumes it before provider compute.

### Idempotency / concurrency / retry / side-effect verification

- Existing duplicate active-capture claims, immutable trace/version writes, scheduled occurrence idempotency, automation execution leases, bounded retries, and verification-before-success are unchanged.
- The change closes an accidental cross-system transition: authoring can no longer mutate an `ACTIVE`/`PAUSED`/`RUNNING` automation while Scheduler remains configured for the published version.
- There is no new retry loop, lease/outbox/recovery state, or browser/model execution path.
- A proper post-publish revision workflow remains intentionally separate because DynamoDB automation state and EventBridge Scheduler cannot be changed atomically; inventing one here would broaden the slice and reintroduce the exact partial-state risk this gate removes.

### Cost / observability / user recovery

- Rejected production captures now fail before AgentCore Browser allocation and Live View signing, avoiding unnecessary cloud-session cost.
- No AWS resource, SDK dependency, database schema, metric dimension, queue, or retained CI artifact was added.
- Users correcting a failed Fresh Test remain supported because `READY_TO_TEST` is an authoring state. Successfully tested or published automation revisions require a future explicit product command rather than silent in-place editing.

### Regression coverage

New tests prove:

- the closed authoring-state policy accepts `DRAFT` / `COMPILING` / `READY_TO_TEST` and rejects publish/execution/attention/disabled states;
- a compile from `READY_TO_TEST` cannot create a second immutable workflow version without another accepted capture;
- an `ACTIVE` automation cannot persist a replacement trace or lose its published state;
- AWS rejects an `ACTIVE` automation before any AgentCore Browser start or Live View signing call;
- ordinary draft capture remains available.

Exact-head GitHub Actions is authoritative. This slice must not be considered validated until CI completes on the published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- A tested or published automation does not yet have an explicit “revise workflow” transaction. That feature should first pause/fence production scheduling and execution, then return the automation to authoring; this slice intentionally blocks accidental editing rather than approximating that orchestration.
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
4. start one Live View capture, authenticate, optionally verify **Cancel capture & start over**, then complete capture, compile, and inspect;
5. verify the Fresh Test form shows exactly the captured runtime inputs required by the immutable workflow, then run a Fresh Test lasting more than 30 seconds and confirm asynchronous UI progression to its durable result;
6. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
7. confirm a published automation cannot silently reopen capture/compile while its schedule remains live;
8. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
9. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
