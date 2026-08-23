# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture/trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with OpenAI BYOK reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, workflow revision, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `238935e0c9dcb800422a0ad0806ee5f2c825fc32` (`Clarify dashboard latest run provenance`).
- GitHub Actions CI #254 failed on that exact head during the real Next.js Lambda packaging build, after deterministic lock verification, frozen install, and `pnpm check` had already passed.
- Authoritative CI logs showed one packaging defect: `apps/web/lib/dashboard-last-run.ts` imported the TypeScript source as `./view-model.js`, which Turbopack could not resolve from source.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This corrective slice — restore the production web package build

### Root cause and correction

The dashboard provenance helper itself type-checked correctly, but its source-level relative import used the emitted JavaScript suffix (`./view-model.js`). The standalone Next.js/Turbopack production build resolves the TypeScript source graph directly and therefore failed with `Module not found: Can't resolve './view-model.js'`.

The helper now imports `./view-model` extensionlessly, matching the established Next.js source-module convention already required elsewhere in this repository. No dashboard behavior or run authority changed.

### Security / tenant isolation / authority

- This is a module-resolution correction only. Cognito tenant/user ownership, run persistence, Scheduler authority, execution leases, Browser Profiles, BYOK credentials, AgentCore workload identity, and human-resume authority are unchanged.
- No new user-controlled input, secret-bearing data, browser capability, or durable identifier is introduced.

### Idempotency / concurrency / retry / verification / recovery

- No mutation, retry, lease, outbox, queue, browser/model call, verification rule, or recovery mechanism changed.
- The dashboard remains a read-only presentation of already-sanitized durable run summaries.

### Cost / observability

- No AWS resource, SDK dependency, DynamoDB read/write, Scheduler API call, Browser session, model token, email send, metric dimension, or retained GitHub Actions artifact was added.

### Validation

- CI #254 is the authoritative root-cause evidence: deterministic lock verification, frozen installation, and `pnpm check` passed; `Package Next.js web Lambda` failed only on the source import resolution above.
- The existing dashboard provenance regressions remain unchanged because runtime behavior is unchanged.
- The production Next.js Lambda packaging gate is the regression gate for this correction and must pass on the exact corrective head before this slice is considered green.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today; additional providers must not be advertised until their adapters and deployment contracts exist.
- Workflow revision does not force-cancel an execution already admitted before disablement; immutable workflow version plus execution lease keep that run isolated.
- Recurring secret typed workflow inputs remain unsupported by design; they require vault-backed secret references if the live product needs them.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but partial infrastructure failure remains an operational reconciliation concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. configure an OpenAI BYOK credential;
4. create an automation, complete Live View capture, compile/inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. confirm the dashboard clearly identifies that result as a Fresh Test rather than a scheduled production occurrence;
6. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then confirm the truthful next occurrence;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution and confirm the dashboard identifies the latest result as a Scheduled run;
8. inspect verification/history/CloudWatch/SES, then deliberately expire target authentication, use secure Live View repair, resume, and follow the terminal post-resume result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
