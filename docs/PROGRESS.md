# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the intended lifecycle from `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority remains the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` points to `1da59ac92862d06cc9caeacbfec7370a92d3a289` (`Keep capture recording identity server-side`).
- The exact pre-merge PR #5 head `8d3d7a936479c036b3a20893075bf0b903d3d2f3` passed GitHub Actions CI #295 before squash promotion.
- No separate push-triggered CI result for the squash SHA is claimed here.
- Exact-head GitHub Actions remains authoritative for every new product slice.

## This product slice — editable automation objective with safe re-authoring

### Defect

The safe workflow revision loop could change browser steps through Disable -> Capture -> Compile -> Fresh Test -> Republish, but the authenticated product had no supported way to change the automation's objective itself. A user who learned during testing that the goal was wrong could reteach the mechanics but remain permanently bound to the original objective used by capture and semantic recovery.

### Behavior

- The provider-neutral control plane now supports an explicit objective revision command.
- Objective changes are allowed only in non-executing authoring states: `DRAFT`, `COMPILING`, `READY_TO_TEST`, `READY_TO_PUBLISH`, or `DISABLED`.
- `ACTIVE`, `RUNNING`, `PAUSED`, capture/test execution, and human-attention states are rejected. A published automation must therefore be disabled before its objective can change.
- A changed objective invalidates any prior compile/Fresh-Test readiness. Unpublished automations return to `DRAFT`; previously published automations remain `DISABLED`.
- The previous immutable workflow version, schedule metadata, Browser Profile, and run history remain available for audit/revision continuity.
- Old reusable scheduled input values are cleared because their `capture_input_N` bindings belong to the previous workflow contract.
- The next capture must carry the new objective, and the existing trace-ownership check still rejects an old-objective trace before compilation.
- Submitting the same normalized objective is idempotent and does not reset readiness or perform a write.
- The existing 4,000-character draft objective limit is reused rather than introducing a second product boundary.

### Authenticated product UX

- The automation detail page now includes an **Automation objective** editor when the lifecycle is safe for re-authoring and no capture is active.
- If a capture is active, the user must finish or cancel it before changing the objective.
- `ACTIVE`/`PAUSED` automations tell the user to Disable first, preserving the existing fail-closed Scheduler fencing model.
- A successful update tells the user to capture and Fresh-Test the revised goal before publication.
- The browser supplies only the objective text. Tenant/user ownership and lifecycle state are resolved from authenticated server state.

### Security / tenant isolation

- Tenant/user authority remains derived only from authenticated control-plane context; request-body ownership/status fields cannot select another scope or force a lifecycle state.
- Browser Profile references, capture/session IDs, workflow graph identities, BYOK secrets, workload tokens, and provider/browser errors remain server-side.
- Objective updates do not grant Browser, model, Scheduler, or recovery authority.
- The direct API rejects cross-tenant automation IDs as `NOT_FOUND` before lifecycle state is disclosed.

### Idempotency / concurrency / retry / verification

- Same-objective replay is a no-op.
- Changing an objective while a capture request is racing can at worst cause that old-objective trace to be rejected by the existing capture/automation objective match; it cannot compile into the revised automation. The Next.js mutation also suppresses the common case by refusing objective edits while capture state is active.
- Immutable prior workflow versions and already-admitted runs are not mutated. Any run admitted before a published automation was disabled remains pinned to its original workflow version and existing execution lease.
- Scheduler mutation, workflow retry/timeout policy, effect verification, and human-resume machinery are unchanged.

### Cost / observability / user recovery

- Objective editing is one control-plane metadata update plus existing summary reads; it starts no AgentCore Browser/Runtime or model work.
- Clearing stale scheduled inputs avoids carrying obsolete configuration into the replacement workflow.
- User recovery is explicit: Disable if published -> update objective -> Capture -> Compile/inspect -> Fresh Test -> Republish.

## Regression coverage added

- exact allowed/disallowed objective-revision lifecycle states;
- READY_TO_PUBLISH objective change invalidates prior test readiness;
- DISABLED published revision preserves immutable publication context while staying disabled;
- stale scheduled inputs are removed on objective change;
- ACTIVE automation rejects objective mutation with zero persistence writes;
- same normalized objective is idempotent;
- exact 4,000-character objective bound is accepted and oversized input rejected;
- authenticated HTTP ownership takes precedence over forged tenant/user/status fields;
- cross-tenant objective mutation remains `NOT_FOUND`.

## CI #297 root cause and corrective dependency review

The normal product head `a38dbe863099242b68e32cb3d8b5a410054e6eac` triggered GitHub Actions CI #297. pnpm `10.15.0` completed lockfile-only resolution and then the deterministic supply-chain gate stopped the run before dependency installation, type checking, packaging, or tests. No package manifest changed in this slice.

The reviewed lock fingerprint changed from:

`17c21e89f7aa6c41459972158807fa6ed47d7a5bb3f53dbb598f87dc85fa7b4f`

to the exact CI-produced SHA-256:

`93779e00f81343c50d61d1389227b3dc5fa39677b79900db4df9abc35ff0bff4`

The corrective commit authenticates only that exact generated graph plus this progress record. The pinned pnpm version remains `10.15.0`; the explicit `@aws-sdk/client-dynamodb@3.1111.0` / `@aws-sdk/util-dynamodb@3.1103.0` peer-alignment assertions remain unchanged. The dependency gate is not bypassed or weakened.

## Validation status for this run

The objective-revision implementation, authenticated HTTP/web wiring, regression coverage, and progress record were published in the single normal multi-file commit `a38dbe863099242b68e32cb3d8b5a410054e6eac`.

CI #297 failed exclusively at the reviewed lock-snapshot gate described above; it never reached installation or product-code validation. The one permitted corrective commit changes only the reviewed lock fingerprint plus this validation record. GitHub Actions on the exact corrective head is authoritative. No green claim is made until that run completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs controlled real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Objective metadata updates use the existing automation repository read/modify/write boundary. Competing independent metadata mutations can race; this slice does not add a narrow CAS subsystem without live evidence that it is required.

## Next product milestone

Once exact-head CI is green, prioritize deliberate promotion and the protected real AWS vertical demo:

1. deploy immutable release through GitHub OIDC;
2. validate VPC Browser readiness and public/auth smoke;
3. Cognito/Google sign-in and OpenAI BYOK setup;
4. create automation with objective/consent;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect semantic workflow;
7. run a Fresh Test lasting more than 30 seconds and observe asynchronous completion;
8. approve/publish recurrence + timezone + any non-secret scheduled inputs;
9. observe EventBridge -> SQS -> Step Functions -> AgentCore scheduled execution, verification, history, CloudWatch, and SES;
10. exercise correction by disabling, changing the objective, recapturing, Fresh-Testing, and republishing;
11. deliberately expire target authentication and complete secure Live View repair/resume.

Concrete defects exposed by that environment should drive subsequent work before any further recovery micro-hardening.
