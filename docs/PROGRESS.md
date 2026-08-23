# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `74a28530eff90837ce808cdf935ac798c06971b8` (`Gate Fresh Test on usable BYOK credential`).
- GitHub Actions CI #256 passed completely on that exact head, including deterministic lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — surface Fresh Test credential readiness before submission

### Product defect and correction

The authenticated Fresh Test POST already performs a sanitized OpenAI BYOK readiness check before it creates a cloud test run. The automation detail page, however, still rendered an apparently runnable Fresh Test form whenever the workflow itself was ready. A user with no usable OpenAI credential therefore had to click the button and be redirected to credential settings to discover a condition the page could already explain safely.

The detail page now checks sanitized credential summaries only when the workflow is otherwise ready for a new Fresh Test. If the deterministic primary OpenAI credential is unavailable, the test form is replaced with an explicit credential-setup action. Once a usable credential exists, the normal Fresh Test form is shown.

The presentation lookup is intentionally best-effort. A credential-summary read outage does not make the whole automation page unavailable and does not manufacture a `NEEDS_CREDENTIAL` decision; the form remains available and the existing POST mutation plus AgentCore execution-plane `CredentialPoolPreflightCheck` still perform authoritative checks before cloud execution.

### Security / tenant isolation / secret handling

- The page consumes `ProviderCredentialSummary` only. Raw API keys and AgentCore secret references never enter this readiness helper or page rendering.
- Credential summaries are still loaded through the authenticated Cognito-derived tenant/user control-plane client. The browser cannot choose another tenant/user scope.
- The readiness state exposes only `READY`, `NEEDS_CREDENTIAL`, or `UNKNOWN`; it does not expose credential IDs, secret references, provider error text, or raw cooldown metadata in the automation page.
- The deployed web product remains OpenAI-only for reasoning; Google sign-in federation is unrelated to model-provider readiness.

### Idempotency / concurrency / retry / verification / recovery

- This is a product/readiness guard only. It grants no execution authority and changes no run ID, automation lease, retry policy, verification contract, Scheduler behavior, Browser Profile state, or human-resume machinery.
- Credential health can change after page render. The POST mutation re-reads credential summaries and the AgentCore execution plane re-reads authoritative metadata before Browser/model allocation, so stale UI state remains fail-safe.
- Same-provider failover remains disabled; the web readiness helper still follows deterministic primary ordering by priority, failure count, then credential ID.

### Cost / availability / observability

- The extra credential-summary read occurs only when the automation is otherwise ready for a new Fresh Test. It is not performed while asynchronous Fresh Test polling is active, avoiding repeated DynamoDB/control-plane reads every five seconds.
- A proven unavailable credential now avoids the pointless click/redirect round trip and makes the zero-cloud-execution path visible before submission.
- No AWS resource, dependency, IAM permission, Browser session, model call, queue, metric dimension, email, or retained Actions artifact was added.
- A credential-summary read failure degrades to `UNKNOWN` presentation rather than taking down the automation detail page.

### Validation

- Extended web regression coverage for the presentation readiness states: usable OpenAI key -> `READY`, no/unusable key -> `NEEDS_CREDENTIAL`, summary-read uncertainty -> `UNKNOWN`.
- Existing readiness regressions continue to cover `UNKNOWN`/`HEALTHY`, cooldown expiry, `DISABLED`/`EXHAUSTED`, unsupported providers, deterministic primary ordering, and no same-provider failover.
- Exact-head CI must pass deterministic lock verification, frozen install, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the full test suite before this slice is considered green.

## Known production risks intentionally left visible

- The web readiness check is not authorization. Credential health can change concurrently; the execution plane remains authoritative.
- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. confirm the automation page shows the OpenAI credential setup action before Fresh Test when no usable key exists, then configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. confirm the dashboard clearly identifies that result as a Fresh Test rather than a scheduled production occurrence;
6. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
7. observe Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution and confirm the dashboard identifies the latest result as a Scheduled run;
8. inspect verification/history/CloudWatch/SES, then deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
