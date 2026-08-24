# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the end-to-end lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority is the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` currently points to `1d08de6431568d81896eaf38d9569f5c04b52a46` (`Pin GitHub Actions dependencies immutably`).
- PR #3 started from that validated production content.
- Exact-head GitHub Actions remains authoritative for every branch change.

## This product/security slice — keep run diagnostic identities server-side

### Defect

The rendered run-diagnostics page already hid internal workflow node IDs and raw evidence artifact references, but the authenticated JSON response still contained those identifiers. The first implementation removed them from `RunDetailView`, and CI #284 correctly exposed one remaining authority leak: the Next.js human-resume helper still depended on `currentNodeId`/checkpoint node IDs to choose `expectedNodeId` for the resume request.

That was not merely a stale test. If node identities are server-only, the web tier must not select the durable resume boundary at all.

### Behavior

- User-facing failure diagnostics expose only the classified failure code, retryability, and a bounded evidence count.
- User-facing checkpoint diagnostics expose attempt count, repeated-state count, completed-step count, evidence count, last classified failure, and timestamp; internal node IDs and artifact references remain server-side.
- Semantic workflow progress still provides human-readable step ordinal, kind, and objective when the immutable workflow is available.
- Target-auth repair eligibility and explicit HUMAN continuation eligibility remain server-derived boolean UX hints.
- The human-resume control-plane service now derives `expectedNodeId` exclusively from the latest authenticated durable checkpoint after validating run/checkpoint identity and agreement.
- `POST /v1/automations/:automationId/runs/:runId/resume` no longer accepts node identity as request authority. Extra/spoofed `expectedNodeId`, tenant, user, resolution, or branch fields are ignored.
- The Next.js resume route checks only the sanitized `humanResumeEligible` hint before submission; the provider-neutral control plane and AgentCore Runtime remain the final action authorities.
- Target-auth takeover completion now calls the same three-argument server-authoritative resume API; it no longer forwards a paused-node identifier after profile repair.
- The obsolete web node-resolution helper and its identifier-bearing fixtures are removed.

### Security / tenant isolation

- Tenant/user ownership checks remain unchanged and occur before run/checkpoint state is returned or resume execution is submitted.
- Raw browser/provider errors, workflow variables, page fingerprints, selectors, verification expectations, Browser Profile/session identifiers, BYOK material, workload tokens, evidence references, and chain-of-thought remain excluded from browser-visible diagnostics.
- Browser/request/takeover-adjacent data can no longer choose the paused workflow node used for human resume.
- AgentCore Runtime still revalidates durable run/checkpoint/workflow state before browser/model side effects.

### Idempotency / concurrency / retry / verification

- Human-resolution claim IDs, execution leases, heartbeat fencing, immutable workflow pinning, retries, and verification remain unchanged.
- The fixed server-owned resolution ID remains the at-least-once idempotency identity for authenticated explicit-HUMAN continuation.
- A stale browser snapshot can at most submit a resume request; the control plane reloads durable state and fails closed if the run moved or checkpoint identity disagrees.
- Target-auth takeover still validates the repair session against the same durable checkpoint before saving the profile, and the resume service reloads the authoritative checkpoint again before execution.

### Cost / observability / user recovery

- No new DynamoDB/S3/AgentCore/model request is added. The resume route already loaded the run detail for eligibility, and the resume/takeover services already load durable run/checkpoint state before execution.
- Existing CloudWatch/SES reporting is unchanged.
- Human takeover/resume UX remains available while less execution-control metadata crosses the web boundary.

### Regression coverage

Tests prove:

- semantic progress remains available while internal node/artifact identities are absent from run-detail responses;
- failure/checkpoint evidence is represented only by bounded counts;
- target-auth repair eligibility is derived server-side without exposing paused-node identity;
- human resume derives the expected node from durable checkpoint state;
- forged HTTP `expectedNodeId`/tenant/user/resolution fields cannot select the resume boundary;
- mismatched durable run/checkpoint nodes fail before execution;
- cross-tenant/cross-automation access remains `NOT_FOUND`;
- malformed/unbounded durable evidence state still fails closed;
- target-auth repair continues to save the repaired Browser Profile and invoke the same idempotent resume authority without passing node selection into the public resume API;
- the authenticated web client submits an empty resume command body and cannot choose the paused node.

### CI #284 root cause and corrective action

CI #284 on `716fb6bd30199b5cecbccc219d036d428b5f7ae9` passed deterministic lock verification and frozen installation, then failed `pnpm check` in `apps/web` because `run-resume-state.ts` and its tests still referenced the intentionally removed `RunDetailView.currentNodeId` / `RunCheckpointView.currentNodeId` fields. Packaging and tests were correctly skipped.

The corrective change moves resume-node selection into the trusted provider-neutral control-plane service rather than restoring those identifiers to the sanitized API. No type or CI check is weakened.

### CI #285 root cause and follow-up correction

CI #285 on `989200bd1958a12205377feaa0f75acb318e3829` passed deterministic lock verification and frozen installation, then failed `pnpm check` at `packages/core/src/human-takeover.ts` because `HumanTakeoverService.finish()` still called the removed four-argument resume signature with browser-adjacent `expectedNodeId` authority.

The follow-up correction keeps the same server-authoritative design: takeover still validates run/checkpoint/node agreement before saving the repaired Browser Profile, then invokes `HumanResumeControlPlaneService.resume(scope, automationId, runId)`. The resume service independently reloads and validates the durable checkpoint before submitting execution. No node identifier is restored to the web/API contract and no check is weakened.

### CI #286 dependency-review root cause and corrective action

CI #286 on `c60a846083054aa5f6d04c5568c02e088c1acefc` stopped before installation or code validation at the deterministic pnpm supply-chain gate. No package manifest changed. pnpm `10.15.0` re-resolved upstream transitive dependencies and produced the authoritative lock SHA-256 `c87b71a17552dc8774acfd425cf7695f8e7ff644035c1f83f1dbf80282069753` instead of the previously reviewed `0fba2807...` snapshot.

The single corrective commit updates only the reviewed lock fingerprint plus this progress record. The existing AWS SDK/DynamoDB peer-alignment assertions remain unchanged; the gate is not bypassed or weakened.

### CI #287 root cause and correction

CI #287 on `e74aa276d9c54ce52835349384c827935d67a92e` passed deterministic lock verification and frozen installation, then exposed one stale web regression test. `apps/web/lib/human-resume-client.test.ts` still called `resumeRun(automationId, runId, expectedNodeId)` and expected `{ expectedNodeId }` in the authenticated POST body even though production intentionally changed the contract to `resumeRun(automationId, runId)` with an empty JSON body.

The correction changes only that obsolete test expectation. It explicitly proves that the web client sends no paused-node authority; durable node selection remains inside the provider-neutral control plane. No production behavior, type safety, or CI gate is weakened.

### Validation status

Exact-head GitHub Actions on the stale-test correction is authoritative. No pass is claimed until that workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Browser Profile and credential-vault creation can leave bounded orphan resources after ambiguous/abandoned cross-service creation; cleanup must not guess under uncertain persistence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, run the protected real AWS vertical demonstration from `main`:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure an OpenAI BYOK credential;
3. create an automation and exercise replay-safe creation under request uncertainty;
4. capture a real workflow through AgentCore Live View and trusted worker completion;
5. compile, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
7. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, effect verification, sanitized diagnostics/history, CloudWatch, and SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path rather than additional recovery micro-hardening.