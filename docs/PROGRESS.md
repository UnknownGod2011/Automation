# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the end-to-end lifecycle in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority remains the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` points to `741314d3362d6544a1615d8cb903e1cd8a683dfc` (`Keep compiled workflow graph server-side`).
- That production content was validated on exact pre-merge PR head by GitHub Actions CI #292 before squash promotion.
- PR #5 (`Keep capture recording identity server-side`) is the active production slice.
- Normal head `7d354bf3466be98ff8b1949e7174c01f543d4276` contains the product/security change described below.
- GitHub Actions CI #294 stopped before installation or code validation at the deterministic pnpm lock-snapshot gate.
- Exact-head GitHub Actions remains authoritative; no pass is claimed until it exists.

## This product/security slice — keep capture recording identity server-side

### Defect

The product forms no longer contained a capture-session identifier, but the authenticated web client and provider-neutral capture-recording HTTP wrapper still supported sending `captureSessionId` on Start/Finish commands. `CaptureRecordingView` also serialized the current durable capture-session ID back to the browser.

That was unnecessary execution-control metadata. The authenticated user should choose only the automation and the recording action; the control plane already owns the durable current-capture pointer and can resolve the authoritative session itself.

### Behavior

- `CaptureRecordingView` exposes only `ACTIVE/NONE`, phase, finish-requested state, and expiry. The durable capture-session ID is no longer browser-visible.
- Start/Finish recording commands now carry only authenticated tenant/user scope plus automation identity.
- The provider-neutral control plane resolves the current unexpired `STARTED` capture from durable state, then uses its server-owned session ID internally for control transitions and Runtime collector launch.
- The authenticated HTTP wrapper ignores forged `captureSessionId`, tenant, or user fields in request JSON; those fields cannot select the capture session.
- The Next.js server client sends `{}` for Start/Finish recording and no longer needs a preliminary capture-state read merely to recover an internal session ID.
- Cancellation already used the server-resolved current capture and remains unchanged.

### Security and tenant isolation

- Tenant/user ownership remains derived only from authenticated context.
- Browser session IDs, Browser Profile references, capture-session IDs, Live View credentials, and provider credentials remain server-side.
- A stale browser can submit only “start current workflow recording” or “finish current workflow recording”; it cannot target an older/different capture session.
- The durable active-capture pointer and capture-control store remain the concurrency and replay authority.

### Idempotency / concurrency / retry / verification

- Duplicate Start still replays the durable `AUTH_SETUP -> WORKFLOW` transition and may retry Runtime launch; duplicate Finish remains replay-safe.
- Expired captures remain restartable and are not treated as active command targets.
- No workflow execution retry, verification, Scheduler, lease, or human-recovery behavior changed.

### Cost / observability / user recovery

- Start/Finish no longer require the Next.js mutation route to fetch capture state solely to obtain the internal session ID, removing one control-plane request per command.
- No DynamoDB/S3/AgentCore/browser/model resource is added.
- Existing cancel/restart UX and capture-readiness polling remain unchanged.

## CI #294 root cause and corrective dependency review

CI #294 completed pnpm 10.15.0 lockfile-only resolution, then the deterministic supply-chain gate detected upstream transitive drift before install, type-checking, packaging, or tests. No package manifest changed.

The reviewed lock fingerprint changed from:

`c87b71a17552dc8774acfd425cf7695f8e7ff644035c1f83f1dbf80282069753`

to the exact CI-produced SHA-256:

`17c21e89f7aa6c41459972158807fa6ed47d7a5bb3f53dbb598f87dc85fa7b4f`

The corrective commit authenticates only that exact graph. The pinned pnpm version remains `10.15.0`, and the existing AWS SDK/DynamoDB peer-alignment assertions remain unchanged. The lock gate is not bypassed or weakened.

## Validation status for this run

The normal commit contains the provider-neutral capture command/view narrowing, authenticated HTTP and Next.js client changes, regression coverage for server-owned capture identity and response redaction, and this progress record.

After CI #294 root-cause inspection, the single permitted corrective commit updates only the reviewed deterministic lock fingerprint plus this validation record. GitHub Actions on the exact corrective head is authoritative. No green claim is made before the workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs controlled real-environment validation.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Browser Profile and credential-vault creation can leave bounded orphan resources after ambiguous/abandoned cross-service creation; cleanup must not guess under uncertain persistence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, promote the reviewed slice and run the protected real AWS vertical demonstration from `main`:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure an OpenAI BYOK credential;
3. create an automation and launch one authoritative AgentCore Live View capture;
4. start/finish recording without any browser-selected capture-session identity and let the trusted worker complete profile/trace persistence;
5. compile and inspect the semantic workflow, then run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
7. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, effect verification, sanitized diagnostics/history, CloudWatch, and SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path rather than additional recovery micro-hardening.
