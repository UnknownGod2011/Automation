# Production Progress

Updated: 2026-08-27

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `d6b9dd01352e21d2aca983d50167f97843a7ea2a` (`Make main protection bootstrap operable`), and push CI #388 completed successfully on that exact SHA. There were no open pull requests. GitHub still reports `main.protected=false`; Issue #29 tracks the operational protection step required before the first AWS deployment.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with constrained reasoning fallback, mandatory effect verification, authenticated capture/run evidence, run timeline/reasoning/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — improve native capture semantics

### Product defect

The browser capture installer previously recorded `role` only when a site explicitly supplied an ARIA `role` attribute and recorded `accessibleName` only from `aria-label`. Ordinary native controls such as `<button>`, labelled `<input>`, `<textarea>`, `<select>`, checkbox, radio, and normal links therefore often lost the semantic role/name that Playwright can target reliably. On real sites without `data-testid` or stable IDs this pushed compiled workflows toward brittle tag/CSS fallbacks and unnecessary semantic recovery even though the browser already exposed stronger native semantics.

### Change

- Capture now infers conservative native roles for common controls: button, link, textbox/searchbox/spinbutton/slider, combobox/listbox, checkbox, and radio.
- Accessible-name capture now prefers explicit `aria-label`, then `aria-labelledby`, then associated native `<label>` text, then button/link text.
- Role/name strings remain bounded to the existing capture metadata limits.
- The installer deliberately never reads `element.value` to derive semantic metadata; user-entered values remain on the existing redacted/runtime-input boundary.
- Explicit ARIA roles still take precedence over inferred native roles.
- The compiler/runtime are unchanged: TEST_ID remains the highest-priority deterministic strategy, then ROLE/name, then text/CSS/XPath. Existing effect verification remains mandatory before success.

### Security / tenant isolation / privacy

This is capture metadata only. No tenant authority, Browser Profile identity, capture-session identity, BYOK secret, workload token, run variable, cookie, or provider credential is added to the trace. Associated labels and ARIA naming text are bounded UI metadata; field values are never consulted. Authentication setup remains separated from executable WORKFLOW capture and password/file/miscellaneous unsupported-control rules remain unchanged.

### Idempotency / concurrency / retry / timeout

No idempotency key, durable state transition, retry budget, lease, heartbeat, or scheduling behavior changes. Better deterministic target metadata should reduce selector failures and therefore reduce retry/model fallback cost rather than add work. Capture collector readiness, click/change coalescing, submit normalization, navigation association, and Finish fencing are unchanged.

### Side-effect verification / user recovery

Native semantic metadata changes only target resolution quality. It does not authorize a new browser primitive or weaken allowed-side-effect constraints. Consequential actions still require the existing captured expected-effect verification. If all deterministic strategies drift, the existing bounded retry/escalation policy remains authoritative.

### Cost / observability

No AWS resource, IAM permission, dependency, Browser allocation, model request, S3 write, queue delivery, or retained Actions artifact is added. The additional DOM reads are local to the already-running capture page and bounded. More reliable ROLE/name strategies should reduce unnecessary semantic-recovery/model usage on ordinary sites.

### Regression coverage / validation

Focused tests cover native role inference for common HTML controls, bounded accessible-name selection, inclusion of the semantic helpers in the actual injected installer, `aria-labelledby` support, and an explicit guard that the installer does not read `element.value` for semantic naming.

GitHub Actions on the exact branch head remains authoritative; this document must not be read as claiming the slice is green until that run exists and completes successfully.

## Known production risks / intentionally parked work

- `main` is still unprotected until an administrator runs `scripts/configure-main-protection.sh --apply` (or configures an equivalent stronger policy) and GitHub confirms it. The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Promote this slice only after exact-head CI is green.
2. Apply/verify `main` protection with the existing admin helper and close Issue #29.
3. Configure/verify the protected production GitHub Environment and its OIDC deployment variables/reviewer policy.
4. Run the manual immutable AWS deployment and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
5. Execute the controlled vertical: Cognito/Google -> OpenAI BYOK -> AgentCore Live View capture -> trusted completion/evidence -> Compile/inspect -> guided >30-second Fresh Test -> guided Publish -> Scheduler/SQS/Step Functions/AgentCore -> SES/CloudWatch -> controlled auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
