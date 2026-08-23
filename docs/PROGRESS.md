# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `a7d426063c61a99f968c15961c2625d2e259b1a2` (`Fix dashboard module resolution`).
- GitHub Actions CI #255 passed completely on that exact head, including deterministic lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite.
- PR #1 remains open, draft, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative; no slice is considered green before its own workflow run completes successfully.

## This product slice — avoid impossible Fresh Test submissions

### Product defect and correction

The production execution plane already performs a fail-closed BYOK credential preflight before AgentCore Browser/model allocation. The authenticated Next.js product, however, still submitted Fresh Test whenever a workflow was otherwise testable, even when the user had no currently usable OpenAI BYOK credential. That submission could not succeed: it created an avoidable AgentCore Runtime invocation and a durable `WAITING_FOR_HUMAN / NOT_CONFIGURED` run before directing the user back to credential setup.

The server-side web mutation boundary now reads only the existing sanitized credential summaries before submitting Fresh Test. If the deployed OpenAI credential pool has no usable primary credential, the request redirects to authenticated credential settings without creating a Fresh Test run or invoking AgentCore Runtime. The execution-plane `CredentialPoolPreflightCheck` remains authoritative and still runs for every real cloud execution.

The web readiness rule intentionally mirrors the current production routing policy:

- only the deployed `openai` provider is considered;
- the primary credential is selected deterministically by priority, then failure count, then credential ID;
- `UNKNOWN` and `HEALTHY` are immediately usable;
- `COOLDOWN` is usable only after its bounded expiry;
- `DISABLED` and `EXHAUSTED` are unavailable;
- same-provider failover remains disabled, so a healthier secondary key does not silently bypass the primary key's state.

### Security / tenant isolation / secret handling

- The web preflight consumes `ProviderCredentialSummary` only. Raw provider keys and AgentCore secret references are not returned to the browser or used by this presentation guard.
- Credential listing remains scoped by the authenticated Cognito-derived tenant/user control-plane context; request bodies cannot choose another ownership scope.
- The check grants no execution authority. A credential can change after the web check, and the AgentCore execution-plane preflight still re-reads authoritative credential metadata before Browser/model work.
- The product continues to advertise only OpenAI reasoning because that is the only concrete deployed BYOK reasoning adapter.

### Idempotency / concurrency / retry / verification / recovery

- No durable execution idempotency key, automation lease, retry policy, verification contract, Scheduler boundary, or human-resume machinery changed.
- Stale credential state is fail-safe: if a credential becomes unavailable after the web check, the authoritative execution preflight blocks the run as before; if it becomes available after a web rejection, the user can resubmit from credential settings.
- The web check does not introduce same-provider key rotation or a retry loop.

### Cost / observability

- A rejected Fresh Test now avoids one unnecessary AgentCore Runtime invocation and the associated blocked-run persistence path.
- The guard adds one authenticated control-plane credential-summary read only when the user intentionally submits Fresh Test; it adds no browser session, model call, AWS resource, IAM permission, queue, metric dimension, dependency, or retained Actions artifact.
- Durable execution telemetry remains unchanged because no run exists when the product preflight rejects the request.

### Validation

- Added web regression coverage for `UNKNOWN`/`HEALTHY`, cooldown expiry, `DISABLED`/`EXHAUSTED`, unsupported providers, deterministic primary ordering, and the production no-same-provider-failover rule.
- The exact-head CI must pass deterministic lock verification, frozen install, `pnpm check`, all production package builds, AWS release/deployment/demo/OIDC contracts, and the full test suite before this slice is considered green.

## Known production risks intentionally left visible

- The web credential check is a product/cost guard, not authorization. The execution plane remains the only authoritative BYOK preflight because credential health can change concurrently.
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
3. confirm Fresh Test routes to credential setup before cloud execution when no usable OpenAI key exists, then configure a usable OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. confirm the dashboard clearly identifies that result as a Fresh Test rather than a scheduled production occurrence;
6. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution and confirm the dashboard identifies the latest result as a Scheduled run;
8. inspect verification/history/CloudWatch/SES, then deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
