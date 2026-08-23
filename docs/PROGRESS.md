# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, bounded automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming PR #1 head: `6d3d201430a5fbcb10b4b81c05fb19220c2b85d5` (`Keep capture compile identity server-side`).
- GitHub Actions CI #246 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — bound automation draft metadata before cloud allocation

### Product/security defect closed

The Next.js create form already limited names to 160 characters and objectives to 4,000, but `AutomationProductLifecycleService.createDraft()` did not enforce those limits. A direct authenticated API caller could bypass the form and submit oversized durable metadata. Name/objective validation also happened after Browser Profile allocation, so an invalid request could consume AgentCore Browser Profile resources before being rejected.

The provider-neutral lifecycle is now the authoritative metadata boundary. Draft creation validates and bounds every durable user-controlled field before duplicate lookup, Browser Profile creation, or persistence.

### Changes

- Added exported `AUTOMATION_DRAFT_LIMITS`:
  - automation ID: 128 characters;
  - name: 160 characters;
  - website URL: 2,048 characters;
  - objective: 4,000 characters.
- Added fail-closed bounded non-empty validation; values are rejected rather than truncated.
- Website URLs are bounded before target-policy parsing and rechecked after canonical normalization.
- `createDraft()` now validates automation ID, name, objective, and target URL before any Browser Profile allocation.
- The Next.js create page imports the same provider-neutral limits so browser affordances and server authority cannot drift; the URL field now also has the 2,048-character bound.

### Security / tenant isolation

- Authenticated API callers can no longer create unbounded automation metadata that later flows into DynamoDB, workflow compilation/model context, logs, or resource names.
- Rejected metadata creates zero Browser Profile resources, reducing a cheap allocation-amplification path.
- Tenant/user ownership remains exclusively the authenticated scope; no new client-selected secret/profile identity was introduced.
- Existing public-target/SSRF policy remains authoritative after the new size gate.

### Idempotency / concurrency / retry / verification

- Draft creation still performs duplicate automation detection within the ownership scope before successful allocation.
- The new validation is deterministic and side-effect free; invalid requests are not retried and cannot partially create automation state.
- Browser execution, scheduling, run idempotency, workflow retries, effect verification, and human recovery are unchanged.

### Cost / observability / user recovery

- Invalid oversized requests now fail before AgentCore Browser Profile cost.
- No AWS resource, SDK dependency, table, queue, model call, browser session, metric dimension, or retained Actions artifact was added.
- Errors remain bounded validation messages; provider/internal errors and secrets are not exposed.
- User recovery is simply to submit metadata within the documented product bounds.

### Regression coverage

Core tests prove each oversized automation ID/name/objective/website URL is rejected with zero Browser Profile allocations, while exact-boundary values remain accepted and allocate exactly one profile only after validation.

### CI validation

- Normal implementation commit: `d85c7d6ecadb97c4aa3b15a004cebafc0ab26baa` (`Bound automation draft metadata before allocation`).
- CI #247 stopped before installation/type-check/tests at the deterministic pnpm supply-chain gate. No package manifest changed; pnpm 10.15.0 re-resolved the transitive graph from reviewed SHA `00456e6d43e48cfb385db6eb7ba1afeb1543a6e79b051b61f72e76851d1ecabd` to authoritative CI-generated SHA `999e13c64e1f9a4b8cda605fea8aad510229afd66aef12bff45265e6286a53a6`.
- The AWS DynamoDB peer-alignment assertions remained intact. The single corrective commit updates only that reviewed lock fingerprint plus this progress record.
- Exact-head GitHub Actions remains authoritative; this slice is not considered green until the corrective head completes CI successfully.

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
3. configure BYOK;
4. create a bounded automation draft, complete Live View capture, compile from the server-owned latest capture, inspect, and run a Fresh Test lasting more than 30 seconds while the UI follows durable state;
5. publish with recurrence/timezone and any explicitly non-secret recurring inputs;
6. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
7. deliberately expire target authentication, use bounded secure Live View repair, submit resume, and confirm the diagnostics page automatically follows the run through its terminal post-resume outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
