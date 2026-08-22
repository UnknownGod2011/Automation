# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `a0993bc28aad023520f3f4129b89471dc8b1ffef` (`Fence workflow authoring from published execution`).
- GitHub Actions CI #241 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — make workflow revision explicit and execution-safe

### Product gap closed

The previous slice correctly prevented an `ACTIVE`, `PAUSED`, `RUNNING`, or human-attention automation from silently reopening Capture while its production schedule could still execute. That safety fence also left a normal product need incomplete: a user who had successfully tested or already published a workflow had no supported path to teach a corrected workflow version.

The existing schedule lifecycle already provides the correct production fence for a published automation. `disable()` first persists durable `DISABLED` state and only then disables EventBridge Scheduler. A stale Scheduler delivery therefore reaches execution preflight after the automation is already non-executable. This slice reuses that boundary rather than creating another cross-system transaction or recovery state machine.

### Changes

- `canAuthorWorkflowCapture()` now treats `READY_TO_PUBLISH` and `DISABLED` as safe authoring states in addition to `DRAFT`, `COMPILING`, and `READY_TO_TEST`.
- `READY_TO_PUBLISH` is safe because no production schedule has been activated yet; the user may return to Capture to correct a tested plan instead of being forced to publish it first.
- A published automation becomes editable only after the user explicitly disables it through the existing schedule lifecycle. `ACTIVE`, `RUNNING`, `PAUSED`, target-auth/credential/attention states, `CAPTURING`, and `TESTING` remain blocked from capture.
- Starting a new capture from `DISABLED` preserves the existing immutable published workflow version, schedule metadata, Browser Profile reference, and run history while moving the automation into the new revision's `COMPILING` state after the trace is accepted.
- Compilation still requires exactly `COMPILING`; the revision creates a new immutable workflow version, requires a fresh test, and must pass the existing latest-successfully-tested publish gate before Scheduler can be enabled again.
- Republish continues to replace stale scheduled non-secret input configuration with the values validated against the newly compiled graph.
- The AWS AgentCore capture starter automatically consumes the expanded provider-neutral policy, so it still rejects executable states before allocating Browser compute or signing Live View.

### Security / tenant isolation

- Ownership validation remains tenant/user scoped and independent of lifecycle state.
- No client may turn an `ACTIVE` automation into authoring state merely by calling Capture; explicit schedule disablement remains the prerequisite for published revisions.
- Browser Profile references, session IDs, Live View capability material, BYOK secrets, workload tokens, selectors, captured values, and execution identities remain server-side.
- Existing public-target URL policy and VPC-backed AgentCore Browser requirements are unchanged.

### Idempotency / concurrency / retry / verification

- The revision path intentionally relies on the existing fail-closed disable ordering: durable `DISABLED` first, external Scheduler disable second. If the Scheduler mutation is uncertain, preflight still rejects stale delivery because durable state is authoritative.
- A concurrent run already admitted before disablement remains governed by the existing automation execution lease; this slice does not invent an unsafe forced-cancel mechanism for in-flight browser effects.
- Capture duplicate claims, immutable trace/version writes, fresh-test run identity, scheduled occurrence idempotency, bounded retries, and verification-before-success remain unchanged.
- No new retry loop, lease, outbox, crash-reconciliation state, or external side-effect path was added.

### Cost / observability / user recovery

- Published revisions allocate AgentCore Browser compute only after the automation is durably non-executable.
- Reusing the existing disable/publish lifecycle adds no AWS resource, SDK dependency, IAM permission, queue, table, metric dimension, or retained CI artifact.
- The user can now correct a successfully tested workflow before publication, or disable a published automation, teach a replacement, fresh-test it, and republish while preserving prior versions and history.

### Regression coverage

New tests prove:

- only non-executing authoring states (`DRAFT`, `COMPILING`, `READY_TO_TEST`, `READY_TO_PUBLISH`, `DISABLED`) permit capture;
- executable, in-flight, and human-attention states remain rejected;
- a disabled published automation can accept a new capture while preserving its published version, schedule, Browser Profile reference, and previous scheduled-input metadata during authoring;
- an active published automation still cannot accept capture;
- a successfully tested but not yet published automation can return to capture for correction.

Exact-head GitHub Actions remains authoritative. This slice is not considered validated until CI completes on the final published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Workflow revision intentionally does not force-cancel an execution already admitted before disablement. The existing execution lease/immutable version keeps that run isolated; operators/users should wait for or resolve an in-flight run before teaching a replacement when side effects could conflict.
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
5. run a Fresh Test lasting more than 30 seconds and confirm asynchronous UI progression to its durable result;
6. verify correction before first publish by returning from `READY_TO_PUBLISH` to Capture, then fresh-test the replacement;
7. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
8. verify published revision requires explicit Disable before Capture, then teach/test/republish a new immutable version while prior history remains intact;
9. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
10. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
