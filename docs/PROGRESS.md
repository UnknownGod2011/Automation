# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `5e162150f2233aea74b8bffd261bec2157aa6ac6` (`Refresh notification preference lock snapshot`).
- GitHub Actions CI #250 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — editable per-automation notification preferences

### Product gap closed

Notification preferences were accepted only when the automation draft was created. After publication, a user could not change ordinary failure or success notifications without rebuilding the automation even though these flags are ordinary durable automation configuration. This was inconsistent with the long-lived scheduled product lifecycle.

The authenticated product now has a dedicated Notifications settings page. Users can change `notifyOnSuccess` and `notifyOnFailure` independently for each automation without changing workflow versions, schedules, Browser Profiles, run state, or execution authority.

Human-attention notifications remain intentionally mandatory. `WAITING_FOR_HUMAN` reporting is not controlled by either optional flag, so authentication repair and other required owner action cannot be silently disabled.

### Provider-neutral control-plane changes

- Added `UpdateNotificationPreferencesCommand` and `AutomationControlPlaneService.updateNotificationPreferences()`.
- Updates resolve the automation through the authenticated tenant/user scope before mutation.
- The full automation record is preserved; only the two optional notification flags and `updatedAt` change.
- Exact same-value submissions are idempotent and avoid a DynamoDB write.
- `POST /v1/automations/:automationId/notifications` requires both boolean fields and ignores any spoofed tenant/user fields in request JSON.
- No new repository, table, queue, scheduler operation, browser/model invocation, retry layer, or recovery authority was introduced.

### Authenticated Next.js UX

- Added `/settings/notifications`, linked from authenticated primary navigation.
- The page lists tenant-scoped automations and their current success/failure preferences using the existing sanitized dashboard response.
- It shows the deployment notification capability (`CONFIGURED`, `LOCAL_MOCK`, or `NOT_CONFIGURED`) instead of pretending delivery is available.
- The existing product copy explicitly states that human-attention pauses always notify the owner.
- Added a same-origin server mutation route; browser form data contains only the automation path identity and the two preference booleans. Tenant/user ownership remains Cognito-derived.

### Security / tenant isolation / recovery

- Cross-tenant updates fail at the existing scoped automation repository lookup before persistence.
- Browser Profile references, capture/session identifiers, credentials, workload tokens, run variables, and provider/browser errors remain absent from the settings response and form.
- Preference changes cannot start, retry, pause, resume, or otherwise mutate a workflow run.
- Mandatory human-attention reporting remains unchanged and continues through the existing trusted recipient resolver.

### Idempotency / concurrency / retry / verification

- Same-value preference submissions are read-only after the scoped lookup and summary read.
- A changed preference uses the existing automation-record read/modify/write pattern; there is no new cross-system transaction.
- As with other automation-record mutations, two genuinely concurrent independent control-plane writes can race at the repository boundary. This slice does not introduce a new CAS/version field solely for preferences; the live deployment should determine whether broader optimistic-concurrency control is needed across automation settings.
- Browser/model retries, side-effect verification, scheduling idempotency, automation locks, and human-resume claim/lease fencing are unchanged.

### Cost / observability

- Same-value submissions avoid a DynamoDB write; changed settings require only the existing scoped automation read/write and summary reads.
- No AWS resource, SDK dependency, retained GitHub Actions artifact, model token, Browser session, email send, or metric dimension was added.
- Changing a preference does not itself send a notification.

### Validation

- Added provider-neutral regressions for successful preference changes, exact replay/idempotency, cross-tenant isolation, required booleans, spoofed ownership suppression, preservation of server-only record fields, and sanitized summaries.
- Added authenticated web-client routing coverage for encoded automation IDs, request-scoped bearer authorization, and the exact preference payload.
- Normal product commit for this slice is published only after all changes in this section are batched atomically.
- Exact-head GitHub Actions remains authoritative; do not consider the slice green until its PR-head CI run succeeds.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
- Workflow revision intentionally does not force-cancel an execution already admitted before disablement. The existing execution lease/immutable version keeps that run isolated; users should let or resolve an in-flight side-effecting run before teaching its replacement.
- An abandoned browser may survive until its bounded AgentCore session expiry if post-cancellation cleanup is uncertain; durable cancellation still prevents its trace/profile from becoming authoritative.
- Same-provider BYOK key rotation remains opt-in; the platform does not rotate keys to evade provider quotas/rate limits.
- Recurring secret typed workflow inputs remain unsupported by design; if the live product needs them, they require vault-backed secret references rather than ordinary automation metadata.
- DynamoDB and EventBridge Scheduler cannot be updated in one transaction; lifecycle ordering is fail-closed but reconciliation after partial infrastructure failure remains an operational concern.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof that an ambiguous external side effect did or did not happen.

## Next product milestone

Run the protected real AWS deployment and controlled vertical demonstration using the deployment-provisioned VPC AgentCore Browser:

1. deploy immutable artifacts and pass the live public/auth smoke;
2. sign in through Cognito/Google and verify the trusted notification identity;
3. configure BYOK and confirm the new notification settings surface reflects deployed SES capability;
4. create a bounded automation draft, complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES, then change success/failure preferences and verify subsequent delivery follows them while human-attention notification remains mandatory;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
