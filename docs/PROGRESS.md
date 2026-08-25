# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The repository implements the intended lifecycle from `docs/END_GOAL.md`: Cognito/optional Google sign-in, dashboard/authoring, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable capture completion, semantic WorkflowGraph compilation/inspection, asynchronous Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback and effect verification, durable history/diagnostics, SES/CloudWatch reporting, safe workflow/objective revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless the real vertical exposes a correctness blocker. Product priority remains the protected AWS deployment and controlled end-to-end demonstration.

## Incoming validation

- `main` points to `31365b928b273ce7a97a7295955fedf132ad4c7c` (`Keep automation detail usable during history outages`).
- Push-triggered GitHub Actions CI #307 completed successfully on that exact SHA on August 25, 2026.
- No open production PR existed at the start of this slice.
- Exact-head GitHub Actions remains authoritative for every new change.

## This slice — isolate automation metadata from run-history availability

### Defect

The previous web slice treated the dedicated run-history request as fail-soft so capture and workflow inspection could remain usable during a transient run-store outage. The provider-neutral control plane still undermined that behavior: `getAutomation()` and metadata-summary mutations called `runs.listForAutomation()` merely to decorate an automation summary with its latest run. A run-store outage could therefore fail the automation metadata request before the web tier reached its dedicated fail-soft history read. The dashboard had the same coupling and could collapse entirely when one automation history read failed.

### Behavior

- `getAutomation()` now resolves owned automation metadata plus latest completed capture without reading run history.
- Metadata-returning mutation summaries no longer depend on run-history availability.
- The dashboard remains history-aware, but each automation history read is isolated. A failed history read marks only that automation with `lastRunUnavailable=true` rather than failing the whole dashboard.
- Dashboard rendering distinguishes **Latest run temporarily unavailable** from **No runs yet**; it does not fabricate an empty history.
- The dashboard no longer reads latest capture-completion state because that data is not rendered there. Capture readiness remains on the automation detail path where it is product-relevant.
- Healthy automations on the same dashboard still retain their real latest run and provenance.
- The dedicated `/runs` history boundary remains authoritative for Fresh Test provenance, publishing, and detailed run history; its sanitized `409 CONFLICT` behavior is unchanged.
- Automation metadata intentionally reports durable lifecycle/attention state without importing run-specific failure codes. Classified run failures remain available on run-aware dashboard/history/diagnostic surfaces.

### Security / tenant isolation

- Tenant/user scope remains authenticated and server-owned for automation, run-history, and capture reads.
- A transient history failure is represented only by a boolean availability signal; provider/DynamoDB exception text remains server-side.
- Browser Profile/session IDs, trace IDs, workflow/node identities, evidence artifacts, BYOK secrets, workload tokens, runtime variables, and raw provider/browser errors remain excluded.
- Cross-tenant automation lookup behavior is unchanged and remains `NOT_FOUND`.

### Idempotency / concurrency / retry / timeout / verification

- No execution admission, run idempotency, automation lease, Scheduler mutation, retry/timeout policy, deterministic/semantic browser behavior, effect verification, or human-resume authority changed.
- No retry loop was added. Dashboard degradation is a single-read classification, not hidden repeated load.
- Metadata mutations no longer fail after a successful write merely because a subsequent decorative history read is unavailable.
- Fresh Test and Publish remain fail-closed when their dedicated run-provenance read is unavailable.

### Cost / observability / user recovery

- Dashboard cost is reduced by one capture-completion read per automation; only run history is read for latest-run decoration.
- Automation detail keeps the capture-completion read it needs, while removing its duplicate/decorative history dependency from the metadata request.
- No new AWS resource, AgentCore Browser/Runtime allocation, model call, queue/Scheduler operation, SES send, CloudWatch metric, dependency, or Actions artifact is added.
- Users can continue navigating healthy automation metadata and authoring surfaces during a run-store incident while seeing a truthful availability warning.

## Regression coverage

- owned automation metadata loads successfully while the run repository throws, and the run repository is not called;
- one dashboard automation can report `lastRunUnavailable=true` while another still shows its real successful latest run;
- dashboard rendering no longer needs capture-completion reads;
- metadata-only notification-preference replay remains usable while run history is unavailable;
- metadata/detail responses keep `PAUSED` / `needsAttention` without depending on a run-specific `TARGET_AUTH_REQUIRED` code, while dashboard/history responses still preserve the classified failure;
- the existing dedicated history tests still enforce sanitized `409 CONFLICT` and cross-tenant `NOT_FOUND` behavior.

## Validation status

- Normal implementation head `535513fce034448354f29516c870578cf3bf4cdb` ran as GitHub Actions CI #308.
- CI #308 passed deterministic lock verification, frozen installation, strict `pnpm check`, AgentCore Runtime packaging, control-plane Lambda packaging, Next.js Lambda packaging, and every AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contract.
- All new history-isolation tests passed. The full core suite reached 317 passing tests with one stale existing assertion in `run-history-http-redaction.test.ts` that still required `TARGET_AUTH_REQUIRED` to appear in the automation metadata response.
- That assertion encoded the old decorative-history behavior. The corrective commit aligns it with the new boundary: automation metadata retains `PAUSED` / `needsAttention`, while classified failure codes remain on run-aware dashboard/history surfaces. No production behavior or check is weakened.
- GitHub Actions on the exact corrective PR head is authoritative. Do not claim green until that workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior remains structurally tested with fakes/deployment contracts but needs real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Automation metadata settings still use the existing repository read/modify/write boundary; competing independent metadata mutations can race.
- Capture-completion storage remains authoritative for compile readiness; an outage there still correctly blocks capture/compile-specific surfaces rather than being misreported as a history outage.

## Next product milestone

After exact-head CI is green, promote this bounded correctness fix and prioritize the protected AWS vertical demo:

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
