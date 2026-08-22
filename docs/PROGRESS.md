# Production Progress

## Current production state

The platform now implements the intended AWS-first vertical product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery is intentionally parked unless an end-to-end correctness defect requires it. The product priority is a controlled real AWS deployment and fixing defects discovered by that live lifecycle.

## Incoming validation

- Incoming branch head: `03793684a4411d2df2608d9b53993208cc08a456` (`Prevent duplicate active cloud captures`).
- GitHub Actions CI #237 completed successfully on that exact head before this slice began.
- The PR remains open, draft, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite are mandatory gates.

## This slice — cancel and restart an abandoned cloud capture

### Product defect found

The new active-capture concurrency guard correctly prevents a second authoritative capture while an unexpired `STARTED` capture exists. That exposed a user-facing dead end: if the user accidentally closes or loses the short-lived Live View capability, the platform intentionally cannot reconstruct that signed URL, but it also had no explicit way to abandon the durable active capture. The user could therefore be blocked from starting over until the old session expired.

### Changes

- Capture sessions now have an explicit terminal `CANCELED` state with a bounded cancellation timestamp.
- The capture-recording control plane exposes an authenticated, server-resolved cancellation command.
  - The browser does not submit a capture-session ID for cancellation.
  - The service resolves the tenant/user/automation-scoped active capture from durable state.
  - Cancellation is persisted before browser cleanup is attempted, so a racing collector cannot later turn an abandoned capture into an accepted profile/trace.
- `AwsDynamoCaptureSessionStore.cancel` atomically:
  - transitions the exact `STARTED` session to `CANCELED`; and
  - releases only that session's current-capture pointer.
  Conditional contention is classified by a strongly consistent read; only a durable canceled winner is replay-safe.
- Capture completion now rejects a canceled session before Browser Profile persistence or trace acceptance.
- The authenticated Next.js product now exposes **Cancel capture & start over** while capture is active and Finish has not been requested. The action contains no internal capture/session/profile identifier.
- After cancellation, the durable capture slot is immediately available for a replacement capture. Partial workflow evidence is not accepted as a completed capture.

### Security / tenancy

- Cancellation authority comes from the authenticated tenant/user scope plus the automation route; the browser cannot choose an internal capture-session ID.
- Browser session IDs, Browser Profile references, Live View URLs, cookies, captured input values, BYOK keys, and workload tokens remain server-side.
- A canceled capture cannot later persist its profile/trace through `CaptureCompletionService`.
- The product continues to avoid persisting or reconstructing the Live View capability itself.

### Idempotency / concurrency

- The durable transition and current-pointer release happen in one DynamoDB transaction.
- A completion/cancellation race has a single durable winner. Completion requires `STARTED`; cancellation requires `STARTED`; neither can silently overwrite the other terminal state.
- Exact repeated cancellation is safe at the persistence boundary. The user-facing route resolves the current capture server-side, so once cancellation has released the pointer a later request simply sees no active capture rather than targeting stale browser identity.
- The existing duplicate-start guard continues to prevent two authoritative active captures.

### Retry / timeout / verification

- Cancellation adds no retry loop and does not alter workflow execution retries or side-effect verification.
- Capture Finish remains the only path that saves the authenticated Browser Profile and accepts the trace. Cancel deliberately does not make partial workflow evidence compilable.
- Browser cleanup after durable cancellation is best-effort and non-authoritative; durable cancellation remains final even if cleanup is uncertain.

### Cost / observability / user recovery

- Users no longer need to wait for an abandoned capture to expire before restarting, which removes a real capture UX dead end.
- The durable claim is released immediately, avoiding repeated failed attempts to allocate a replacement capture.
- If the control-plane composition cannot confirm browser stop after cancellation, the abandoned AgentCore Browser session may remain until its existing bounded session expiry. That is a visible cost limitation, not execution authority; it does not block a replacement capture or allow the canceled collector to complete.
- No new AWS resource, queue, model call, metric dimension, dependency, or recovery subsystem is introduced.

### Regression coverage

Changed tests prove:

- durable cancellation occurs before browser cleanup;
- cancellation remains authoritative when cleanup is uncertain;
- the HTTP cancellation route ignores forged capture-session identity and uses authenticated durable state;
- DynamoDB cancellation atomically marks the session canceled and releases only its exact current-capture claim;
- a lost conditional cancellation race is replay-safe only when the durable winner is canceled;
- the authenticated web client calls the cancellation route without an internal capture-session ID.

Exact-head GitHub Actions remains authoritative. This change must not be considered validated until CI completes successfully on the published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
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
4. start one Live View capture, authenticate, verify **Cancel capture & start over** once with an intentionally abandoned handoff, then complete a replacement capture, compile, and inspect;
5. run a Fresh Test lasting more than 30 seconds and verify asynchronous UI progression to its durable result;
6. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
8. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not by additional recovery micro-hardening.
