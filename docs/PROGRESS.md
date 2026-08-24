# Production Progress

## Current production state

The AWS-first cloud browser automation vertical is on `main`. The platform covers the end-to-end lifecycle in `docs/END_GOAL.md`: Cognito/optional Google sign-in, authenticated dashboard, replay-safe automation creation, AgentCore Browser/Profile capture, trusted durable traces, semantic workflow compilation/inspection, asynchronous AgentCore Fresh Test with OpenAI BYOK, tested-version publication, EventBridge Scheduler/SQS/Step Functions dispatch, deterministic browser execution with constrained semantic fallback, explicit effect verification, durable run history, SES/CloudWatch reporting, workflow revision, reusable non-secret scheduled inputs, and bounded human takeover/resume.

Recovery/crash machinery remains intentionally parked unless a real end-to-end defect requires it. Product priority remains the protected real AWS deployment and controlled vertical demonstration.

## Incoming validation

- `main` currently points to `27ebb8d8596924cdbf8026da5fb20f6342b59bc6` (`Keep run diagnostic identities server-side`).
- That content was validated on exact pre-merge PR head by GitHub Actions CI #288 before squash promotion. The connector has not surfaced a separate push-triggered `main` run for the squash SHA, so no post-merge CI claim is made here.
- No pull request was open when this development run began.
- Exact-head GitHub Actions remains authoritative for every new branch change.

## This product/security slice — keep the compiled executable workflow server-side

### Defect

The product already exposes a dedicated sanitized semantic workflow-inspection view for users, but the authenticated `POST /v1/automations/:automationId/compile` transport still returned the complete executable `WorkflowGraph` after compilation. A direct authenticated caller could therefore receive internal workflow/node identities, deterministic execution structure, bindings, initial variables, and other implementation-level graph data even though the Next.js product immediately discarded that response and later used the sanitized inspection endpoint.

This was an unnecessary public transport seam, not required execution authority.

### Behavior

- Compilation still resolves the latest trusted completed capture server-side and invokes the same provider-neutral lifecycle/compiler.
- The authenticated compile transport now returns only `{ kind: "COMPILED", workflowVersion }`.
- The executable `WorkflowGraph` remains server-side in the immutable workflow repository and continues to be used by Fresh Test, publication, scheduling, Runtime execution, and the sanitized workflow-inspection service.
- The Next.js compile mutation already ignored the response body, so the user flow remains Capture -> Compile -> inspect semantic plan -> Fresh Test.

### Security / tenant isolation

- Tenant/user ownership, capture-completion provenance, and authoring-state validation are unchanged and remain authoritative before compilation.
- The compile response no longer exposes workflow IDs, node IDs, internal variable values, bindings, deterministic strategy details, Browser Profile references, capture trace IDs, or other executable-graph data.
- This does not hide user-authored objective text from the owner; it narrows the transport to the minimum acknowledgement needed by the product.
- The sanitized workflow-inspection endpoint remains the supported human-readable review surface.

### Idempotency / concurrency / retry / verification

- Compiler versioning, immutable workflow persistence, capture provenance, Fresh Test admission, Scheduler publication, execution leases, retries, and effect verification are unchanged.
- No additional retry or recovery state machine is introduced.
- The known compile partial-write limitation remains: if immutable workflow storage succeeds but the automation-state write definitely fails, a later retry can create another workflow version from the same capture. This slice does not broaden that uncommon cross-store recovery surface.

### Cost / observability / user recovery

- No additional DynamoDB, S3, AgentCore, browser, model, queue, or Scheduler operation is added.
- The response is smaller, reducing unnecessary authenticated API payload size.
- Existing CloudWatch/SES and human takeover/resume behavior is unchanged.

### Regression coverage

A dedicated control-plane HTTP regression proves that a successful compile returns only the bounded acknowledgement and does not serialize the internal workflow ID, node ID, compiled initial variable, trace identity, or Browser Profile reference.

### CI #290 root cause and corrective action

CI #290 on normal head `38e09c8fec457cc586346d44dfb2311b0191e81e` passed deterministic lock verification and `pnpm install --frozen-lockfile`, then failed strict `pnpm check` in `packages/core`. The product change itself was type-compatible; the manually batched Git-data rewrite of `control-plane-http.ts` accidentally omitted one closing `}` from the pre-existing terminal 404 response. TypeScript correctly reported parser errors at the end of the handler and all packaging/tests were skipped.

The single permitted corrective commit restores exactly that missing brace and records this root cause. The bounded compile acknowledgement and regression test are unchanged; no type/CI check is weakened.

### Validation status

GitHub Actions on the corrective exact head is authoritative. No pass is claimed before the corrective workflow completes successfully.

## Known production risks intentionally left visible

- The protected AWS deployment and full live vertical demonstration still need to run in a real environment with approved GitHub Environment/OIDC role/VPC inputs.
- VPC-mode AgentCore Browser is required, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live Cognito/Google/SES/AgentCore behavior is structurally tested with fakes and deployment contracts but still needs the controlled real environment demonstration.
- Only OpenAI has a concrete production BYOK reasoning adapter today.
- DynamoDB and EventBridge Scheduler cannot be mutated atomically; lifecycle ordering is fail-closed but operational reconciliation may still be required after a real partial infrastructure failure.
- Browser Profile and credential-vault creation can leave bounded orphan resources after ambiguous/abandoned cross-service creation; cleanup must not guess under uncertain persistence.
- Recurring secret typed workflow inputs remain unsupported by design and require vault-backed references if live demand proves them necessary.
- Recovery crash-reconciliation remains conservative and intentionally does not manufacture proof about ambiguous external side effects.

## Next product milestone

After exact-head CI is green, deliberately promote the reviewed slice and run the protected real AWS vertical demonstration from `main`:

1. deploy immutable artifacts and pass live public/auth smoke;
2. sign in through Cognito/Google and configure an OpenAI BYOK credential;
3. create an automation and exercise replay-safe creation under request uncertainty;
4. capture a real workflow through AgentCore Live View and trusted worker completion;
5. compile it, verify only the sanitized semantic inspection is user-visible, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
6. publish with server-owned tested-workflow selection, recurrence/timezone, and any explicitly non-secret recurring inputs;
7. verify Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, effect verification, sanitized diagnostics/history, CloudWatch, and SES;
8. deliberately expire target authentication, repair through the hardened Live View handoff, save the repaired Browser Profile, resume, and follow the terminal result.

Further engineering should be driven primarily by concrete failures from that live path rather than additional recovery micro-hardening.