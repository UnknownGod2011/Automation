# Production Progress

## Current production state

The platform implements the intended AWS-first product path: Cognito/optional Google sign-in, authenticated dashboard, automation creation with consent and public-target validation, AgentCore Browser/Profile capture with Live View, durable capture control and trace persistence, semantic workflow compilation/inspection, asynchronous cloud Fresh Test through AgentCore Runtime with BYOK OpenAI reasoning, tested-version publish gating, EventBridge Scheduler/SQS/Step Functions dispatch, durable execution/checkpoints/history, SES/CloudWatch reporting, and bounded human repair/resume. Core execution remains provider-neutral; AWS owns the current production adapters.

Recovery/crash machinery remains intentionally parked unless an end-to-end correctness defect requires it. Product priority is the protected real AWS deployment and defects revealed by that live lifecycle.

## Incoming validation

- Incoming branch head: `5528e578a5636b837d0d20cae9bd383d8a6652bc` (`Fix capture cancellation test authority`).
- GitHub Actions CI #239 completed successfully on that exact head before this slice began.
- PR #1 remains open, draft, mergeable, and unmerged.
- Deterministic pnpm lock verification, frozen installation, strict TypeScript/Next.js validation, production packaging, AWS release/deployment/demo/OIDC contracts, and the full test suite remain mandatory gates.

## This slice — align Fresh Test input UX with trusted workflow requirements

### Product defect found

The Fresh Test mutation boundary already accepts only the exact unresolved compiler-generated `capture_input_N` keys exposed by trusted workflow inspection. The automation page, however, still rendered a generic optional JSON field with an example such as `{"customer":"Acme"}`. That example is not a valid input unless the immutable workflow happens to require that exact internal variable, so the normal UI could actively guide a real user into a request the server correctly rejects.

This is especially important for the protected AWS demo because privacy-preserving capture deliberately replaces typed values with synthetic runtime inputs. The UI must tell the user exactly which captured values are needed rather than suggesting arbitrary variables.

### Changes

- `fresh-test-input-form` now derives both parsing authority and user-facing presentation from one closed trusted requirement set.
- The helper validates the same constraints for display and submission:
  - at most 64 requirements;
  - only `capture_input_N` names;
  - no duplicates.
- When runtime values are required, the Fresh Test page renders a JSON example containing exactly those trusted keys and marks the field required.
- When the immutable workflow requires no unresolved captured inputs, the arbitrary runtime JSON textarea is omitted entirely.
- Malformed trusted workflow requirements fail closed in the UI and suppress Fresh Test submission until the workflow is recompiled rather than presenting an unsafe or impossible form.
- The page explicitly states that Fresh Test values are per-run material that can enter durable checkpoint state and must not contain passwords, OTPs, API keys, tokens, or other authentication secrets. Target-site sign-in remains in the Browser Profile.

### Security / tenancy

- No new workflow variable namespace is exposed. The browser sees only the same privacy-safe `capture_input_N` names already surfaced by sanitized workflow inspection.
- Tenant/user ownership continues to come exclusively from authenticated control-plane context.
- The UI still cannot submit arbitrary workflow variables because the server reloads trusted workflow inspection immediately before parsing the form.
- BYOK keys, workload tokens, Browser Profile references, session identifiers, selectors, captured values, and verification expectations remain excluded.

### Idempotency / concurrency / retry / verification

- This slice does not change execution identity, automation locking, retry budgets, model/browser calls, side-effect verification, Scheduler behavior, or human recovery.
- Fresh Test run IDs remain server-generated and each intentional submission remains separately idempotent through the existing durable occurrence key.
- The change eliminates a client/server contract mismatch before AgentCore Browser/model allocation, so invalid input no longer needs a failed cloud submission to teach the user the accepted shape.

### Cost / observability / user recovery

- No AWS resource, SDK dependency, queue, database read, metric dimension, or model/browser call was added.
- Validating/displaying the same trusted requirements already loaded with workflow inspection has effectively zero incremental cloud cost.
- User recovery is clearer: if the compiled requirement projection itself is invalid, the product tells the user to recompile rather than repeatedly submitting impossible Fresh Tests.

### Regression coverage

Changed tests prove:

- exact trusted capture-generated keys are accepted;
- missing, forged, duplicate, malformed, non-string, and oversized runtime inputs remain rejected;
- the displayed JSON example contains exactly the trusted required keys;
- workflows with no unresolved runtime inputs produce no arbitrary JSON suggestion;
- malformed or duplicate trusted requirement metadata fails closed for both parser and presentation.

Exact-head GitHub Actions remains authoritative. This slice must not be considered validated until CI completes successfully on the published commit.

## Known production risks intentionally left visible

- VPC-mode AgentCore Browser is required by deployment, but real subnet/route/DNS/security-group/firewall policy still needs live proof that private/link-local/control-plane targets stay unreachable after DNS resolution and redirects.
- Live AWS/Cognito/Google/SES/AgentCore integrations are structurally tested with fakes and deployment contracts but still need the controlled real environment demonstration.
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
4. start one Live View capture, authenticate, optionally verify **Cancel capture & start over**, then complete capture, compile, and inspect;
5. verify the Fresh Test form shows exactly the captured runtime inputs required by the immutable workflow, then run a Fresh Test lasting more than 30 seconds and confirm asynchronous UI progression to its durable result;
6. approve/publish with recurrence/timezone and any explicitly non-secret recurring inputs;
7. observe Scheduler → SQS → Step Functions → AgentCore Runtime execution, verification, history, CloudWatch, and SES;
8. deliberately expire target authentication, use bounded secure Live View repair, resume, and verify the post-resume terminal outcome.

Further engineering should be driven primarily by concrete failures from that live path, not additional recovery micro-hardening.
