# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the intended lifecycle from `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, safe workflow/objective revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority remains the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` points to `9403526fa24f0aa9f660482eca61ae3640ca7996` (`Allow safe automation objective revision`).
- Push-triggered GitHub Actions CI #299 completed successfully on that exact SHA on August 24, 2026.
- There is no open production PR at the start of this slice.
- Exact-head GitHub Actions remains authoritative for every new product slice.

## This product/security slice — keep run-history node identity server-side

### Defect

Individual run diagnostics were already hardened to keep workflow-node identities server-side, but the authenticated automation summary and run-history transports still serialized `RunSummaryView.currentNodeId`. The current web UI did not render that field, yet a browser/API client could still read the internal immutable workflow-node identity from dashboard, automation-detail, history, and summary-returning mutation responses.

That contradicted the existing sanitized diagnostics boundary and gave the browser internal execution identifiers it does not need for any product action.

### Behavior

- The authenticated HTTP transport now strips `currentNodeId` from every run summary before returning it to the browser.
- Dashboard automation cards and single-automation summaries sanitize their nested `lastRun` summaries.
- Run-history responses sanitize every returned run summary.
- Summary-returning create/objective/notification/scheduled-input/publish/schedule/pause/resume/disable mutations use the same sanitizer, preventing the field from reappearing through an alternate response path.
- Failure classification, status, timestamps, workflow version, run provenance, and durable run ID remain available because they are required for product history/diagnostic navigation.
- The provider-neutral service may still use `currentNodeId` internally; only the authenticated public transport boundary is narrowed.

### Security / tenant isolation

- Tenant/user authority remains derived from authenticated context and is unchanged.
- Workflow-node IDs, Browser Profile references, capture/session IDs, BYOK secrets, workload tokens, raw provider/browser errors, checkpoint variables, and evidence contents remain server-side.
- This change removes data from responses and grants no new execution, scheduling, browser, model, or recovery authority.

### Idempotency / concurrency / retry / verification

- Read/write authority, run creation, occurrence idempotency, automation locks, retries, timeouts, effect verification, and human-resume claims/leases are unchanged.
- Response redaction is deterministic and stateless; duplicate requests return the same bounded public representation.

### Cost / observability / user recovery

- No additional DynamoDB/S3/AgentCore/Scheduler/SES/CloudWatch calls are introduced.
- Server-side observability may continue to correlate internal node IDs; the browser does not need them.
- Human takeover/resume continues through dedicated server-authoritative control-plane commands and does not depend on run-history `currentNodeId`.

## Regression coverage added

- dashboard response excludes both the internal node value and the `currentNodeId` property;
- single-automation response excludes the same identity;
- run-history response excludes it while retaining the classified failure code;
- summary-returning notification mutation cannot reintroduce the nested last-run node identity.

## Validation status for this run

The run-history redaction implementation, regression coverage, and this progress record are batched into one normal multi-file Git-data commit. GitHub Actions on the exact PR head is authoritative. No green claim is made until that run completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs controlled real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Automation metadata settings still use the existing repository read/modify/write boundary; competing independent metadata mutations can race. No narrow CAS subsystem is added without live evidence that it is required.

## Next product milestone

Once exact-head CI is green, prioritize promotion and the protected real AWS vertical demo:

1. deploy immutable release through GitHub OIDC;
2. validate VPC Browser readiness and public/auth smoke;
3. Cognito/Google sign-in and OpenAI BYOK setup;
4. create automation with objective/consent;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect semantic workflow;
7. run a Fresh Test lasting more than 30 seconds and observe asynchronous completion;
8. approve/publish recurrence + timezone + any non-secret scheduled inputs;
9. observe EventBridge -> SQS -> Step Functions -> AgentCore scheduled execution, verification, history, CloudWatch, and SES;
10. deliberately expire target authentication and complete secure Live View repair/resume;
11. exercise correction by disabling, changing the objective, recapturing, Fresh-Testing, and republishing.

Concrete defects exposed by that environment should drive subsequent work before any further recovery micro-hardening.
