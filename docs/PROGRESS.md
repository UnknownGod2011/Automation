# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The repository implements the intended lifecycle from `docs/END_GOAL.md`: Cognito/optional Google sign-in, dashboard/authoring, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable capture completion, semantic WorkflowGraph compilation/inspection, asynchronous Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback and effect verification, durable history/diagnostics, SES/CloudWatch reporting, safe workflow/objective revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless the real vertical exposes a correctness blocker. Product priority remains the protected AWS deployment and controlled end-to-end demonstration.

## Incoming validation

- `main` points to `82a514f6e09009e72a7544c8ac0ac52dda097da0` (`Distinguish run-history outages from missing automations`).
- Push-triggered GitHub Actions CI #305 completed successfully on that exact SHA on August 25, 2026.
- No open production PR existed at the start of this slice.
- Exact-head GitHub Actions remains authoritative for every new change.

## This slice — keep automation authoring usable during run-history outages

### Defect

The control plane now correctly distinguishes a transient run-history storage failure from a missing automation, returning sanitized `409 CONFLICT` for the owned automation. The Next.js automation detail page still loaded automation metadata, run history, capture state, and workflow inspection in one `Promise.all`. Therefore the run-history `409` still collapsed the entire page into generic `Automation unavailable`, hiding otherwise healthy capture/authoring controls and defeating the product value of the new server-side distinction.

### Behavior

- Automation metadata is loaded first under the authenticated control-plane boundary.
- Run history, capture recording state, and workflow inspection remain parallel secondary reads.
- Only a `CONFLICT` from the dedicated run-history read is treated as a bounded `runHistoryUnavailable` state.
- Capture-state or workflow-inspection conflicts still fail the page rather than being silently normalized.
- When history is unavailable, the page keeps the automation, objective, capture, compile, schedule-management, and semantic workflow inspection surfaces available.
- The page shows an explicit temporary-history warning rather than claiming there are no runs.
- Fresh Test submission/provenance feedback and Publish are suppressed while history is unavailable because those product decisions depend on authoritative durable run provenance.
- Existing runs are never represented as deleted or absent merely because storage is temporarily unreadable.

### Security / tenant isolation

- Tenant/user authority remains entirely in the authenticated control plane; the web helper introduces no client-selected ownership or durable IDs.
- Raw DynamoDB/provider exception text remains hidden behind `WebControlPlaneError`.
- Browser Profile/session IDs, capture trace IDs, workflow node IDs, evidence artifact IDs, BYOK secrets, workload tokens, runtime variables, and provider errors remain server-side.
- This is a read-path UX correction and grants no new execution, scheduling, browser, model, or recovery authority.

### Idempotency / concurrency / retry / timeout / verification

- No run creation, occurrence idempotency, automation lock, Scheduler mutation, browser/model retry, timeout, effect verification, or human-resume semantics changed.
- The web tier adds no retry loop; a user/server render may retry through the normal page request only.
- Publish remains fail-closed because successful Fresh Test provenance cannot be reconstructed from missing history.
- Fresh Test submission is also paused during a history outage to avoid creating another intentional cloud test when the product cannot determine current Fresh Test provenance.

### Cost / observability / user recovery

- The logical read count is unchanged: automation, run history, capture state, and workflow inspection are still read once per page render.
- No AWS resource, AgentCore Browser/Runtime allocation, model call, queue message, Scheduler call, SES send, or CloudWatch metric is added.
- The user can continue safe authoring/capture inspection during a history-store incident while seeing a truthful bounded warning.
- Operational provider details remain in server-side telemetry rather than user-visible responses.

## Regression coverage

- a run-history `CONFLICT` returns automation/capture/workflow data with `runHistoryUnavailable=true` and an empty non-authoritative run list;
- normal history reads preserve the existing result shape;
- non-history request failures are not swallowed;
- capture-state conflicts remain fatal to the detail load rather than being misclassified as history unavailability.

## Validation status

The implementation, web regression tests, and this progress record are batched into one normal multi-file Git-data commit. GitHub Actions on the exact PR head is authoritative. Do not claim green until that workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior remains structurally tested with fakes/deployment contracts but needs real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Automation metadata settings still use the existing repository read/modify/write boundary; competing independent metadata mutations can race.

## Next product milestone

After exact-head CI is green, promote this narrow UX/correctness fix and prioritize the protected AWS vertical demo:

1. deploy immutable release through GitHub OIDC;
2. validate VPC Browser readiness and public/auth smoke;
3. Cognito/Google sign-in and OpenAI BYOK setup;
4. create an automation with objective/consent;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect the semantic workflow;
7. run a Fresh Test lasting more than 30 seconds and observe asynchronous completion;
8. approve/publish recurrence + timezone + any non-secret scheduled inputs;
9. observe EventBridge -> SQS -> Step Functions -> AgentCore execution, verification, history, CloudWatch, and SES;
10. deliberately expire target authentication and complete secure Live View repair/resume;
11. exercise revision by disabling, changing the objective, recapturing, Fresh-Testing, and republishing.

Concrete live-service defects should drive subsequent engineering before additional recovery micro-hardening.
