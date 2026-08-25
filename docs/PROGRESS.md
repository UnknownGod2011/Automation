# Production progress

Updated: 2026-08-25

## Current baseline

- `main` before this slice: `a51ffcac7c2302250a7e3ef97c617778d6b7478b` (`Isolate automation metadata from run history outages`).
- GitHub Actions CI #311 completed successfully on that exact `main` SHA.
- The AWS-first production vertical is structurally present: Cognito/Google auth, Next.js control plane, cloud capture + Browser Profile persistence, trace compiler, semantic workflow inspection, asynchronous AgentCore Fresh Test, publish/scheduling, AgentCore Browser/OpenAI BYOK execution, verification, sanitized history/diagnostics, SES/CloudWatch reporting, and bounded target-auth takeover/resume.
- Recovery/crash-reconciliation machinery is intentionally considered deep enough for the current product milestone. Do not add more recovery micro-hardening unless the vertical slice requires it or CI/live AWS exposes a real correctness defect.

## This slice — authenticated run evidence viewing

### Product gap

`END_GOAL.md` calls for a detailed run record with evidence. Browser execution already persisted redacted browser-state metadata and screenshots in the tenant-scoped artifact store, but the user-facing run diagnostics exposed only evidence counts. Raw S3 artifact references were intentionally hidden, leaving no supported way for the automation owner to inspect the actual safe evidence.

### Change

- Added a provider-neutral `RunEvidenceService` and authenticated read-only route:
  - `GET /v1/automations/:automationId/runs/:runId/evidence/:ordinal`.
  - The browser selects only a bounded 1-based ordinal; the durable artifact reference is resolved from the authorized checkpoint server-side.
  - Run/checkpoint tenant, automation, run and workflow-version identity are revalidated before artifact storage is read.
- Evidence has a closed public schema:
  - bounded PNG screenshots can be returned as base64 to the authenticated owner;
  - known Playwright metadata is reduced to event kind, workflow action kind, sequence and safe origin;
  - state fingerprints, DOM/page text, selectors, workflow node IDs, artifact references and arbitrary JSON fields are discarded;
  - unknown formats remain opaque rather than returning raw bytes;
  - previews above 2 MiB are reported as protected/too-large rather than serialized through the control plane.
- AWS control-plane composition now connects this service to the existing tenant-scoped S3 artifact store.
- The Next.js run page links checkpoint evidence by ordinal and a dedicated authenticated evidence page renders the safe preview. Artifact references never enter the URL or browser contract.
- Added provider-neutral tests for screenshot redaction, metadata allowlisting, unknown-format opacity, cross-tenant suppression before artifact reads, bounded ordinals and GET-only routing, plus a web-client regression for ordinal-only access.

## Security / tenancy review

- Evidence is accessible only after the existing Cognito-authenticated tenant/user scope resolves the durable run.
- The browser cannot submit an S3 key or artifact reference. It can only request an ordinal that is mapped through the authorized checkpoint.
- Cross-tenant/mismatched-run requests fail before `ArtifactStore.get`.
- Browser-state JSON is allowlisted rather than passed through. Provider/browser raw payloads and state fingerprints remain server-side.
- Screenshots can contain page content visible to the automation owner. They are therefore returned only through authenticated, no-store server rendering and are never embedded in URLs, logs, workflow metadata or notification payloads.
- Existing TYPE verification screenshot suppression remains important: typed runtime values are not intentionally captured into post-input screenshots.

## Idempotency / concurrency / retry / timeout

- The evidence path is read-only and has no execution authority, lease, retry or mutation side effect.
- It resolves the latest persisted checkpoint at request time. A stale ordinal after checkpoint replacement can become `NOT_FOUND`; it cannot select an arbitrary artifact.
- Artifact-store uncertainty returns a sanitized conflict while leaving durable run state unchanged.
- No browser/model retry behavior or human-resume authority changed.

## Cost / observability

- Run diagnostics themselves still perform no artifact reads. S3 evidence is read only when the user opens an evidence item.
- A single evidence request reads one artifact. Screenshot serialization is capped at 2 MiB to bound API/Lambda response size and memory amplification.
- No new AWS resource, queue, table, bucket, IAM permission or GitHub Actions artifact was added; the control plane reuses the existing encrypted artifact bucket and IAM scope.

## Validation

Required authoritative validation for the new commit:

1. deterministic pnpm lock verification;
2. frozen install;
3. `pnpm check` including the Next.js production build/type boundary;
4. AgentCore Runtime, control-plane Lambda and Next.js Lambda packaging;
5. AWS release/deployment/demo/live-smoke/OIDC contract checks;
6. full `pnpm test` suite including the new evidence regressions.

Do not claim this slice green until GitHub Actions completes successfully on the exact published head.

## Known production risks / deliberately parked work

- The protected real AWS deployment/full vertical demonstration still has not been completed with real Environment/OIDC/VPC inputs.
- VPC AgentCore Browser route-table/DNS/security-group/firewall containment still requires live proof against private/link-local/control-plane destinations after DNS resolution and redirects.
- Cognito/Google federation, SES delivery and AgentCore Runtime/Browser behavior are structurally tested but still need live-service validation.
- OpenAI is the only concrete production BYOK reasoning adapter today; the core remains provider-neutral for later adapters.
- DynamoDB and EventBridge Scheduler mutations remain separate fail-closed systems rather than one transaction; live operation must validate reconciliation expectations.
- Automation settings still use ordinary repository read/modify/write semantics; broad CAS machinery remains parked unless live concurrency shows material loss.
- Evidence screenshots are intentionally owner-visible and may contain ordinary page data. Evidence retention/deletion policy should be revisited after live usage establishes operational needs.

## Next product milestone

Run the protected real AWS vertical demonstration rather than deepening recovery internals:

1. deploy the immutable green release with GitHub OIDC and real VPC Browser inputs;
2. require live public/auth smoke to pass;
3. Cognito/Google sign-in;
4. configure OpenAI BYOK;
5. AgentCore Live View capture and trusted completion;
6. compile and inspect the semantic plan;
7. run a Fresh Test lasting more than 30 seconds and observe its asynchronous durable result;
8. inspect the run evidence through the new authenticated evidence viewer;
9. publish recurrence/timezone and verify EventBridge/SQS/Step Functions/AgentCore execution;
10. verify run history, SES notification and CloudWatch telemetry;
11. deliberately expire target authentication, repair through secure Live View and resume to a terminal outcome.

From this point, defects exposed by the live environment should take priority over speculative recovery hardening.
