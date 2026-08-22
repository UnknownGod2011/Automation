# Production Progress

## Current production state

The platform now implements the intended AWS-first vertical product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery is intentionally parked unless an end-to-end correctness defect requires it. The product priority is a controlled real AWS deployment and fixing defects discovered by that live lifecycle.

## Incoming validation

- Incoming branch head: `b1917e6de47a5a1c7b290e909a1d3a6453aeae72` (`Show truthful automation lifecycle status`).
- GitHub Actions CI #236 completed successfully on that exact head before this slice began.
- The PR remains open, draft, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite are mandatory gates.

## This slice — prevent duplicate active cloud captures

### Defect found

The production capture starter allocated an AgentCore Browser session before establishing whether the same tenant/user/automation already had a live `STARTED` capture. A repeated capture request (double click, stale page, transport retry, or two workers racing) could therefore allocate another browser session and overwrite the durable current-capture pointer. That creates unnecessary AgentCore cost and, under a race, ambiguous capture ownership until one session times out.

### Changes

- `AgentCoreCaptureSessionStarter` now performs a strongly-consistent active-capture preflight when the configured durable store supports `activeForAutomation`.
  - A matching unexpired `STARTED` capture rejects **before** browser allocation, Live View signing, or control-state mutation.
  - An expired capture does not permanently block a replacement.
  - Durable tenant/user/automation identity and expiry are revalidated before the preflight can suppress or allow browser compute.
- `AwsDynamoCaptureSessionStore.putStarted` now treats the current-capture pointer as a per-automation concurrency claim.
  - The pointer stores `expiresAt`.
  - A conditional transaction permits a new pointer only when none exists, a legacy pointer lacks the new expiry field, or the previous pointer has expired.
  - Concurrent starts that both pass preflight can no longer both become durable winners; a loser fails the transaction and the starter cleans up its newly-created browser session through the existing failure path.
- Capture completion now removes the **exact matching** current-capture pointer in the same DynamoDB transaction that commits the completed session and latest-trace pointer. A completion cannot delete another capture's claim.

### Security / tenancy

- Capture concurrency is scoped by the existing tenant/user-derived DynamoDB partition and automation-specific current pointer.
- The preflight never exposes browser session IDs, Browser Profile refs, or Live View capability URLs.
- Cross-tenant automation objects are still rejected before AgentCore compute.
- No new secret, token, cookie, target-site credential, or browser state is persisted.

### Idempotency / concurrency

- Sequential duplicate capture launches are rejected before AgentCore allocation.
- Simultaneous launches may both briefly allocate before the DynamoDB transaction resolves the race, but only one can become the durable current capture; the losing starter follows the existing cleanup path. This bounds the race without adding another recovery subsystem.
- Completion releases only the matching current pointer, preventing an old worker from clearing a newer capture claim.
- Legacy current-pointer records remain replaceable. The strongly-consistent starter preflight still prevents replacement of a genuinely live legacy session under normal sequential delivery.

### Retry / timeout / verification

- Capture retry behavior is unchanged after a session becomes authoritative. Recording start/finish commands retain their existing replay semantics.
- Expired capture state may be replaced; unexpired active state is authoritative.
- Workflow side-effect verification and execution retries are unchanged by this slice.

### Cost / observability / user recovery

- The primary cost win is avoiding needless AgentCore Browser allocation and Live View signing for repeated capture launches.
- No new AWS resource, queue, model call, metric dimension, or dependency is introduced.
- If a user loses the Live View capability for an unexpired active capture, the platform intentionally does not reconstruct or persist that signed capability. The existing session can be finished/expire, then a new capture can be started. Persisting Live View credentials would weaken the security boundary.

### Regression coverage

Changed tests prove:

- a second live capture is rejected before another AgentCore Browser allocation;
- an expired durable capture can be replaced;
- the DynamoDB current pointer carries expiry and a conditional concurrency claim;
- capture completion atomically writes completion/latest-trace state and releases only the exact matching current-capture claim.

Exact-head GitHub Actions remains authoritative. This change must not be considered validated until CI completes successfully on the published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Same-provider BYOK key rotation remains opt-in; the platform does not rotate keys to evade provider quotas/rate limits.
- Recurring secret typed workflow inputs remain unsupported by design; if the live product needs them, they require vault-backed secret references rather than ordinary automation metadata.
- DynamoDB and EventBridge Scheduler cannot be updated in one transaction; lifecycle ordering is fail-closed but reconciliation after partial infrastructure failure remains an operational concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof that an ambiguous external side effect did or did not happen.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. configure BYOK;
4. start one Live View capture, authenticate, record, finish, compile, and inspect;
5. run a Fresh Test lasting more than 30 seconds and verify asynchronous UI progression to its durable result;
6. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
8. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not by additional recovery micro-hardening.
