# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the end-to-end lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority is the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` currently points to `1d08de6431568d81896eaf38d9569f5c04b52a46` (`Pin GitHub Actions dependencies immutably`).
- That content was reviewed and validated on its pre-merge branch before promotion; exact-head GitHub Actions remains authoritative for any new branch change.
- No post-merge `main` CI pass is claimed here unless GitHub surfaces a completed run for the exact merge SHA.

## This product/security slice — keep run diagnostic identities server-side

### Defect

The rendered run-diagnostics page already hid internal workflow node IDs and raw evidence artifact references, but `RunDetailView` still serialized those identifiers into the authenticated JSON response. A browser therefore received `currentNodeId`, `completedNodeIds`, failure `nodeId`, and raw evidence-reference strings even though the product had no user-facing need for them.

That contradicted the documented sanitized diagnostics boundary and unnecessarily widened durable graph/artifact metadata exposure.

### Behavior

- User-facing failure diagnostics now expose only the classified failure code, retryability, and a bounded evidence count.
- User-facing checkpoint diagnostics expose attempt count, repeated-state count, completed-step count, evidence count, last classified failure, and timestamp; internal node IDs and artifact references remain server-side.
- Semantic workflow progress still provides human-readable step ordinal, kind, and objective when the immutable workflow is available.
- Target-auth repair eligibility is now derived inside the provider-neutral control plane and returned as a boolean UX hint, so the Next.js page no longer needs paused-node IDs or failure-node IDs to decide whether to show the repair action.
- Explicit HUMAN continuation eligibility remains a server-derived boolean and runtime validation remains the final execution authority.
- The run page no longer renders the opaque durable run ID as its title; the route still addresses the correct authenticated run internally.

### Security / tenant isolation

- Tenant/user ownership checks remain unchanged and occur before run/checkpoint data is returned.
- Raw browser/provider error messages, workflow variables, page fingerprints, selectors, verification expectations, Browser Profile/session identifiers, BYOK material, workload tokens, and chain-of-thought remain excluded.
- Evidence references are still validated for bounded/corrupt durable state but are converted to counts before crossing the authenticated API boundary.
- No signed artifact URL or evidence content is introduced in this slice.

### Idempotency / concurrency / retry / verification

- This is a read-only projection change. Run identity, workflow version pinning, checkpoint authority, locks, retries, verification, Scheduler delivery, human-resolution claims, resume leases, and recovery reconciliation are unchanged.
- Target-auth repair remains fail-closed because the Runtime revalidates the durable run/checkpoint/node before any Browser side effect; the new boolean is only a presentation hint.

### Cost / observability / user recovery

- No additional DynamoDB/S3/AgentCore/model request is added. The same run, checkpoint, and optional workflow reads are performed.
- Existing CloudWatch/SES reporting is unchanged.
- Human takeover/resume remains available, but the browser receives less internal control-plane metadata while presenting the same safe repair UX.

### Regression coverage

Tests now prove:

- semantic progress remains available while internal node/artifact identities are absent from the returned run-detail object;
- failure/checkpoint evidence is represented only by bounded counts;
- target-auth repair eligibility is derived server-side without exposing the paused node identity;
- malformed/unbounded durable evidence references still fail closed;
- cross-tenant/cross-automation access remains `NOT_FOUND`;
- workflow-store outages preserve basic diagnostics while semantic/HUMAN eligibility fails closed.

### Validation status

Exact-head GitHub Actions is authoritative. No pass is claimed for this slice until the PR workflow completes successfully on the exact commit.

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
