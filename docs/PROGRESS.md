# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, replay-safe bounded automation creation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, editable non-secret scheduled values, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `1c0ed272f3d36504054104563c46a64cb92b9561` (`Align compile action with lifecycle state`).
- GitHub Actions CI #266 passed completely on that exact head.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for this new slice; no pass is claimed here until the new run completes successfully.

## This product slice — protect target-auth Live View capability handoff

### Product/security defect and correction

Normal cloud capture already avoids putting the signed AgentCore Live View capability in a redirect `Location` header. It returns an ephemeral, `no-store` HTML handoff with `Referrer-Policy: no-referrer`, then requires an explicit user click to open Live View.

Target-auth takeover did not use that boundary. `POST .../takeover/start` validated the returned HTTPS URL and then issued a `303` redirect directly to the signed Live View capability. That meant the capability travelled through an HTTP redirect header even though the product had already established a stricter pattern for the same class of credential-like browser capability.

The takeover route now uses the same hardened handoff primitive. The existing run-diagnostics form already opens takeover in a separate tab, so the handoff keeps that tab separate, places the capability only in the non-cacheable HTML response body, and navigates the handoff tab into Live View only after an explicit user click. The original run-diagnostics tab remains available for **Save repaired session & resume**.

### Security / tenant isolation

- Tenant/user/run authorization remains entirely inside the authenticated control-plane + Runtime takeover boundary; this web change grants no new browser authority.
- Live View URLs must still be bounded HTTPS URLs without embedded username/password credentials.
- The signed Live View capability is absent from redirect `Location`, cookies, and response headers.
- Handoff responses remain `no-store`, `no-referrer`, `nosniff`, restrictive-CSP, restrictive-permissions, and COOP protected.
- The repair copy explicitly preserves the existing policy: users complete login/MFA themselves; the platform does not solve or bypass CAPTCHA, MFA, or other target-site security controls.
- Browser session IDs, Browser Profile references, BYOK material, workload tokens, tenant/user IDs, and resume lease credentials remain server-side.

### Idempotency / concurrency / retry / timeout

- The durable human-takeover session, resume claim, lease, heartbeat, and checkpoint authorities are unchanged.
- Duplicate takeover starts still converge through the existing server-side takeover service; the handoff page is presentation/capability transport only.
- No retry loop, queue, outbox, lease, or new recovery state was added.
- If handoff rendering rejects malformed Live View output, the route returns the existing sanitized `takeover-failed` state rather than exposing provider details.

### Side-effect verification / recovery

- Browser repair remains user-driven and limited to restoring target authentication.
- Saving the repaired Browser Profile and submitting resume still uses the established durable ordering and human-resolution machinery.
- Deterministic execution, semantic fallback, expected-effect verification, checkpoints, effect reconciliation, and terminal reporting are unchanged.

### Cost / observability

- No AWS resource, browser/model invocation, table, queue, IAM permission, dependency, metric dimension, or retained GitHub Actions artifact was added.
- This adds no cloud calls. It only changes how an already-created Live View capability is delivered to the authenticated browser.
- Provider/internal error text remains sanitized.

### Regression coverage

The Live View handoff tests now prove both capture and target-auth repair:

- return status 200 rather than redirecting the signed capability;
- emit no `Location` or `Set-Cookie` header containing the capability;
- use `no-store` and `no-referrer` response policy;
- keep secret query material out of all response headers;
- HTML-escape the capability URL;
- return to the exact server-resolved automation/run diagnostics path;
- preserve the explicit sign-in/MFA/no-bypass repair instruction;
- reject HTTP, credential-bearing, oversized, or identity-less handoff input.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged. The real protected deployment should follow deliberate review/promotion rather than weakening the OIDC branch trust boundary.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- An abandoned create attempt after a definitely-uncommitted metadata write may leave one retry-stable Browser Profile; blind cleanup remains unsafe under ambiguous metadata persistence.
- Expired capture records/control rows are not immediately deleted. They are non-authoritative after expiry and should be cleaned only by a deliberate retention policy if live storage volume makes that worthwhile.
- If immutable workflow persistence succeeds but the mutable automation-status update definitely fails, a retry can still create another workflow version from the same capture. A future idempotent compile identity should be added only if live deployment demonstrates this partial-failure window is material.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration after deliberate promotion to the trusted deployment branch, using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google, verify the trusted notification identity, and configure a usable OpenAI BYOK credential;
3. create one automation and complete Live View capture;
4. compile and inspect the semantic plan, then run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and inspect verification/history/CloudWatch/SES;
6. deliberately expire target authentication, start repair, confirm the signed repair Live View opens through the hardened handoff rather than an HTTP redirect, save the repaired profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
