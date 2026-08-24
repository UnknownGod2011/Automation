# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the end-to-end lifecycle in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority remains the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` points to `27ebb8d8596924cdbf8026da5fb20f6342b59bc6` (`Keep run diagnostic identities server-side`).
- That production content was validated on exact pre-merge PR head by GitHub Actions CI #288 before squash promotion.
- PR #4 (`Keep compiled workflow graph server-side`) is the active production slice.
- PR #4 normal head `38e09c8fec457cc586346d44dfb2311b0191e81e` narrowed the authenticated Compile response to a bounded acknowledgement.
- Corrective head `52381a6af98128957452f5b9f7667c2db8ccb5fc` fixed a parser defect from the manual batched rewrite, but CI #291 then stopped at one strict test-fixture typing error before packaging/tests.
- Exact-head GitHub Actions remains authoritative; no pass is claimed until it exists.

## This product/security slice — keep the compiled executable workflow server-side

### Product boundary

The authenticated `POST /v1/automations/:automationId/compile` endpoint now returns only:

`{ kind: "COMPILED", workflowVersion }`

The executable `WorkflowGraph` remains server-side in the immutable workflow repository. Fresh Test, publication, scheduling, Runtime execution, verification, and semantic workflow inspection continue to use the same persisted graph.

The user-facing review surface remains the sanitized workflow-inspection endpoint; the Compile mutation no longer serializes internal workflow/node identities, execution structure, bindings, initial variables, capture identity, or Browser Profile metadata back to the authenticated client.

### Security and tenant isolation

- Tenant/user ownership and trusted capture-completion provenance remain authoritative before compilation.
- Browser Profile references, capture trace IDs, internal workflow/node IDs, compiled variable values, selectors, bindings, and execution strategy data remain server-side.
- No new credential, browser-session, model, Scheduler, or recovery authority is introduced.

### Idempotency / concurrency / retry / verification

- Compiler versioning, immutable workflow persistence, capture provenance, Fresh Test admission, Scheduler publication, automation locks, retries, and effect verification are unchanged.
- No retry or recovery subsystem is added.
- The known compile cross-store partial-write limitation remains: if immutable workflow persistence succeeds but the automation-state write definitely fails, a later retry can create another workflow version from the same capture. This uncommon case remains visible rather than being expanded into another recovery subsystem before live evidence requires it.

### Cost / observability / user recovery

- No extra DynamoDB, S3, AgentCore, browser, model, queue, Scheduler, SES, or CloudWatch operation is added.
- The authenticated Compile response is smaller and carries less implementation detail.
- Existing human takeover/resume behavior is unchanged.

## CI #290 and #291 root causes

CI #290 passed deterministic lock verification and frozen installation, then TypeScript found a missing closing brace in `packages/core/src/control-plane-http.ts` introduced during the manual Git-data batch. The single corrective commit restored exactly that syntax without weakening checks.

CI #291 passed deterministic lock verification and frozen installation, then stopped in strict `pnpm check` on `packages/core/src/control-plane-http-compile-redaction.test.ts`: the fixture forwarded `record.browserProfileRef`, statically typed `string | undefined`, into a capture-session field requiring `string`.

The production Compile transport was not implicated. This run fixes only the fixture authority by using one explicit known test constant (`server-profile-ref`) for both the automation record and capture-session record. TypeScript remains strict and the raw executable graph is not restored to the response.

## Validation status for this run

This run publishes one coherent commit containing:

- the strict fixture correction for CI #291;
- this `docs/PROGRESS.md` update.

GitHub Actions on the exact resulting head is authoritative. No green claim is made before the workflow completes successfully.

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
3. create an automation and exercise replay-safe creation under request uncertainty;
4. capture a real workflow through AgentCore Live View and trusted worker completion;
5. compile it, verify the executable graph remains server-side while the sanitized semantic inspection remains user-visible, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
7. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, effect verification, sanitized diagnostics/history, CloudWatch, and SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path rather than additional recovery micro-hardening.
