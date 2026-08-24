# Production Progress

## Current production state

The platform implements the AWS-first product lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation, AgentCore Browser/Profile capture, durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head for this run: `cbe59e332768cdcb397aa14c4336df0e4a2d1e80` (`Fail closed when scheduling is not configured`).
- GitHub Actions CI #273 completed successfully on that exact head: deterministic lock verification, frozen install, strict `pnpm check`, all production package builds, AWS hosting/federation/release/deployment/demo/live-smoke/OIDC contracts, and the full test suite passed.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the creation-replay change below; no pass is claimed until a completed successful run exists for the new commit.

## This product slice — make automation creation replay-safe across HTTP retries

### Product/correctness defect

`AutomationProductLifecycleService.createDraft()` already reconciled a lost DynamoDB acknowledgement inside the request that performed the metadata write. The authenticated control-plane boundary nevertheless performed its own early `automation already exists` rejection before calling that lifecycle service. If the client retried the same server-generated creation attempt after the first HTTP request became uncertain, the durable automation could therefore exist while the retry returned `CONFLICT`.

That made the product's create-attempt identity only partially idempotent across real request boundaries even though Browser Profile creation is already retry-stable for the same automation ID.

### Behavior

- `AutomationControlPlaneService.createAutomation()` now treats an existing automation as an idempotent replay only when the authenticated ownership scope and stable creation intent match: automation ID, normalized website URL, trimmed name, trimmed objective, and explicit consent.
- An exact replay returns the current sanitized automation summary and makes zero `createDraft()` calls, so it cannot allocate another Browser Profile or rewrite lifecycle state.
- Different content under the same automation ID remains a `CONFLICT` and also makes zero lifecycle calls.
- Mutable notification preferences are intentionally not part of replay identity. A delayed retry must not overwrite or reject an automation merely because the owner changed those settings after creation.
- The HTTP boundary continues to ignore spoofed tenant/user fields; repository lookup is performed only under authenticated scope.

### Security / tenant isolation

- Replay lookup is tenant/user scoped and cannot discover or adopt another tenant's automation.
- The public replay result remains the existing sanitized `AutomationSummaryView`; Browser Profile references and other server-only resource identifiers are not returned.
- Website comparison reuses the provider-neutral target URL policy, so URL normalization does not create a weaker parallel acceptance path.
- Consent remains mandatory for a create replay; a request that omits/revokes the acknowledgement cannot be treated as successful creation authority.

### Idempotency / concurrency / retry / timeout

- Existing lifecycle locking remains the authority for two concurrent first-time creation attempts before Browser Profile allocation.
- Existing same-request write-ack reconciliation remains intact.
- This slice closes the later HTTP retry window by recognizing the already-durable exact creation intent before attempting lifecycle work again.
- No retry loop, outbox, lease, heartbeat, queue, or recovery subsystem is introduced.

### Side-effect verification / recovery

- Workflow execution, browser effects, verification, scheduling, checkpoints, human takeover, resume, and crash reconciliation are unchanged.
- The only suppressed side effect is duplicate draft/profile creation for an already-durable exact creation attempt.

### Cost / observability

- Exact create retries now require only scoped metadata/run/capture reads needed to construct the normal summary; they allocate no AgentCore Browser Profile and create no execution-plane work.
- Conflicting retries stop after the scoped automation read.
- No AWS resource, IAM permission, dependency, storage schema, metric dimension, or retained GitHub Actions artifact is added.

### Regression coverage

Provider-neutral tests prove:

- an exact creation retry returns the current durable automation state and makes zero lifecycle create calls;
- notification preferences changed after creation do not turn a stable creation retry into a conflict or overwrite the current values;
- conflicting objective content under the same creation-attempt ID remains `CONFLICT` with zero lifecycle work;
- an authenticated HTTP retry converges on the owner's automation while spoofed tenant/user fields have no authority and server-only Browser Profile data remains absent.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged and must be deliberately reviewed/promoted before the live AWS demo.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- If a Browser Profile is created and metadata definitely never commits, an abandoned creation attempt can leave one retry-stable orphan profile. Blind deletion remains unsafe when write outcome is ambiguous; cleanup should be driven by live cost evidence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live product demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, deliberately promote the reviewed PR to the trusted deployment branch and run the protected real AWS vertical demonstration:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure a usable OpenAI BYOK credential;
3. verify the same automation-creation attempt converges after an intentionally uncertain/repeated submission without a second Browser Profile;
4. capture a real workflow through AgentCore Live View, finish capture, compile, and inspect the semantic plan;
5. run a Fresh Test lasting more than 30 seconds and verify the UI follows durable state;
6. exercise `capture`, `cloudExecution`, and `scheduling` `NOT_CONFIGURED` states and confirm each causes zero corresponding cloud work;
7. publish with recurrence/timezone and any explicitly non-secret recurring inputs, then verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
