# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The repository already implements the intended lifecycle from `docs/END_GOAL.md`: Cognito/optional Google sign-in, dashboard and automation authoring, AgentCore Browser/Profile capture, trusted durable capture completion, semantic workflow compilation/inspection, asynchronous Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback and effect verification, durable run history, SES/CloudWatch reporting, safe revision flows, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless the real vertical exposes a correctness blocker. Product priority remains the protected AWS deployment and controlled end-to-end demonstration.

## Incoming validation

- `main` points to `24714cc7125f65a4f3eb1b2d871a3eadcf4523b2` (`Keep run history node identity server-side`).
- PR #7 was merged after exact-head CI #301 passed on its reviewed head.
- No open production PR existed at the start of this slice.
- Exact-head GitHub Actions remains authoritative for every new change.

## This slice — distinguish run-history absence from storage unavailability

### Defect

`AutomationControlPlaneService.history()` previously wrapped every lifecycle/history failure as `NOT_FOUND`. A transient or uncertain run-store failure could therefore tell an authenticated owner that the automation did not exist. That is the wrong product/recovery signal for the run-history stage and can hide an operational outage as an ownership problem.

### Behavior

- Run-history admission now resolves the automation under the authenticated tenant/user scope first.
- A missing or cross-tenant automation still returns `NOT_FOUND` before any run-history read.
- Once ownership is established, run history is read from the run repository directly.
- Run-store/provider uncertainty is converted to a fixed sanitized `CONFLICT` message: `run history is temporarily unavailable`.
- Raw DynamoDB/provider/transport error text is never returned to the browser.
- Normal run summaries and Fresh-Test/Scheduled provenance classification are unchanged.

### Security / tenant isolation

- Tenant/user ownership remains server-derived and is checked before the run repository is queried.
- Cross-tenant callers cannot use outage behavior to distinguish another tenant's automation from absence.
- No Browser Profile, workflow-node, evidence-artifact, BYOK, workload-token, or provider-error material is exposed.

### Idempotency / concurrency / retry / timeout / verification

- This is a read-only control-plane correction. It changes no run creation, occurrence idempotency, locks, retries, browser/model timeouts, side-effect verification, scheduling, or human-resume behavior.
- The request performs the same logical ownership + history reads as the lifecycle history path; it does not add a retry loop.

### Cost / observability / user recovery

- No new AWS resource or execution-plane compute is introduced.
- The product can now distinguish “automation not found” from “history storage temporarily unavailable,” which is actionable operationally and avoids misleading deletion/ownership UX.
- Provider details remain available only through server-side operational telemetry, not user-visible responses.

## Regression coverage

- cross-tenant history returns `NOT_FOUND` and does not call the run-history repository;
- an owned automation with run-store failure returns sanitized `CONFLICT`, not false `NOT_FOUND`;
- HTTP history returns 409 with fixed text and does not leak provider exception text;
- normal history still returns sanitized run summaries with provenance.

## Validation status

This implementation, regression coverage, and progress record are batched into one normal multi-file Git-data commit. GitHub Actions on the exact PR head is authoritative. No green claim is made until that workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior remains structurally tested with fakes and deployment contracts but needs real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Automation metadata settings still use the existing repository read/modify/write boundary; competing independent metadata mutations can race.

## Next product milestone

After exact-head CI is green, promote this narrow product-correctness fix and prioritize the protected AWS vertical demo:

1. deploy immutable release through GitHub OIDC;
2. validate VPC Browser readiness and public/auth smoke;
3. Cognito/Google sign-in and OpenAI BYOK setup;
4. create an automation with objective/consent;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect the semantic workflow;
7. run a Fresh Test lasting more than 30 seconds and observe asynchronous completion;
8. approve/publish recurrence + timezone + any non-secret scheduled inputs;
9. observe EventBridge -> SQS -> Step Functions -> AgentCore execution, verification, history, CloudWatch, and SES;
10. deliberately expire target authentication and complete secure Live View repair/resume.

Concrete live-service defects should drive subsequent engineering before additional recovery micro-hardening.
