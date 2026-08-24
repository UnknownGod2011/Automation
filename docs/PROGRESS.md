# Production Progress

## Current production state

The platform implements the AWS-first lifecycle defined in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publish, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless an end-to-end defect requires it. Product priority is review/promotion followed by the protected real AWS deployment and vertical demonstration.

## Incoming validation

- Incoming PR #1 head: `61ae496a930fde5bbc015e7ebbd67e08682a6158` (`Validate publish schedule before provenance`).
- GitHub Actions CI #278 completed successfully on that exact head.
- PR #1 is open, ready for review, mergeable, and unmerged.
- Exact-head GitHub Actions remains authoritative for the change below; no pass is claimed until a completed successful workflow exists for the new commit.

## This product slice — replay-safe BYOK credential creation in the authenticated web product

### Product/correctness defect

The Create Automation flow already preserves one server-generated creation attempt across uncertain HTTP outcomes, but Add Credential did not. The credentials route generated a fresh UUID on every POST. If the secure credential write committed but the web request result was lost, the user-facing retry created a new credential identity and could allocate a second AgentCore Identity credential provider/secret instead of converging on the first operation.

This is a product-path idempotency and cloud-cost defect, not a recovery-subsystem problem.

### Behavior

- The credentials page now creates one UUIDv4 credential-creation attempt and posts it as a hidden idempotency identity.
- Request failure, sign-in recovery, and temporary `NOT_CONFIGURED` redirects preserve that same attempt identity.
- Raw API keys are never preserved in query strings or rendered back into the page; the user must re-enter the key after an uncertain request.
- A retry uses the same credential ID instead of minting another cloud credential identity.
- If the control plane reports `409 CONFLICT`, the web server performs a sanitized credential-list read and accepts the result as an exact replay only when credential ID, provider, label, and priority still match the original create intent.
- A conflict with different non-secret metadata remains a failure and does not overwrite the existing secret.
- Replay never reads or compares the stored API key because raw provider secrets are intentionally non-retrievable. Existing secret state remains authoritative; changing a key continues to require the explicit Rotate action.
- The page now explains an uncertain request and instructs the user to re-enter the key while retaining the same safe creation attempt.

### Security / tenant isolation

- The creation-attempt ID is not an ownership credential or secret reference. Tenant/user authority remains derived from the authenticated Cognito session and revalidated by the control plane/vault boundary.
- Raw API keys remain confined to the authenticated POST and secure AgentCore Identity/vault path; they are not stored in page state, query parameters, logs, workflow metadata, run state, or ordinary DynamoDB tables.
- Replay comparison uses only already-sanitized credential metadata.
- A different key submitted under the same already-created identity is never silently used to overwrite the existing secret; explicit rotation remains the only supported replacement path.

### Idempotency / concurrency / retry / timeout

- Ordinary repeated web submissions after an uncertain result converge on one credential identity.
- Existing provider-neutral credential creation still rejects an already-present credential before another vault write; the web layer classifies only an exact sanitized-metadata match as successful replay.
- Simultaneous first submissions can still race at the existing credential metadata/vault boundary. The stable credential identity materially reduces duplicate-resource risk, while storage/vault atomicity remains an adapter concern and is not expanded into another recovery subsystem here.
- No new retry loop, lease, queue, outbox, background task, or timeout layer is introduced.

### Cost / observability / recovery

- The normal path adds no AWS request. Only the conflict/replay path performs one existing sanitized credential-list read.
- Reusing the same credential identity prevents a user retry from intentionally creating another managed secret/provider after a lost acknowledgement.
- No Browser, model, Scheduler, Step Functions, SES, or CloudWatch behavior changes.
- Human takeover/resume and crash reconciliation are untouched.

### Regression coverage

A new web helper suite proves:

- valid UUIDv4 creation identities normalize and malformed identities fail closed;
- invalid UUID generators fail closed;
- replay succeeds only for an exact non-secret metadata match;
- changed label, priority, or credential identity is not classified as replay.

The production Next.js build remains part of `pnpm check`, so page/route integration is validated by exact-head CI in addition to the helper tests.

## Known production risks intentionally left visible

- The protected deployment workflow is intentionally restricted to `main`; PR #1 remains unmerged and must be deliberately reviewed/promoted before the live AWS demo.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- A Browser Profile from an abandoned automation-creation attempt can remain orphaned when metadata definitely never committed; cleanup must not guess under ambiguous persistence.
- Credential vault + metadata creation is not a cross-service transaction. This slice makes user retry identity stable and non-overwriting, but a real live failure between vault and metadata writes should be observed before adding any broader reconciliation mechanism.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live product demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, deliberately promote the reviewed PR to the trusted deployment branch and run the protected real AWS vertical demonstration:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure an OpenAI BYOK credential;
3. deliberately repeat the same credential-creation attempt after request uncertainty and confirm only one credential identity/provider exists;
4. verify the same automation-creation attempt converges after an uncertain/repeated submission without a second Browser Profile;
5. capture a real workflow through AgentCore Live View and verify only the trusted worker completion path can make it compile-ready;
6. compile, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
7. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
8. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution plus effect verification/history/CloudWatch/SES;
9. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
