# Production Progress

Updated: 2026-08-28

## Current validated baseline

Authoritative GitHub state at the start of this slice: `main` is `182575b2ad97fbe0351f8a647c40b59b35f65fcd` (`Improve native capture semantic targets`), and push CI #390 completed successfully on that exact SHA. There were no open pull requests. GitHub still reports `main.protected=false`; the fail-closed deployment workflow must continue issuing zero AWS credentials until repository protection is actually configured.

The AWS-first product vertical is structurally implemented: Cognito/Google sign-in, dashboard/create/revision, AgentCore Live View capture with durable Browser Profiles/traces, semantic compilation/inspection, guided asynchronous Fresh Test, guided publish/scheduled inputs, EventBridge Scheduler -> SQS -> Step Functions -> AgentCore Runtime execution, OpenAI BYOK through AgentCore Identity, deterministic-first browser execution with constrained reasoning fallback, mandatory effect verification, authenticated capture/run evidence, run timeline/reasoning/history, SES/CloudWatch reporting, and bounded target-auth takeover/resume.

Further crash-recovery/outbox/lease micro-hardening remains parked unless CI or the real vertical exposes a correctness blocker.

## This development slice — remove opaque event IDs from compiled step intent

### Product defect

Capture retains strong semantic target metadata, but the compiler still generated objectives such as `Enter captured input for event ...`, `Submit captured form for event ...`, and `Activate captured target for event ...`. Those strings are user-visible through semantic workflow inspection and are also supplied to constrained semantic recovery. They leak internal capture event identities into product-facing workflow intent and give the reasoner less useful task semantics than the browser action type already provides.

Using raw accessible names directly as trusted workflow objectives would create a different security problem: accessible names and explicit ARIA roles are website-controlled content and can contain prompt-injection-like text. The workflow objective boundary must improve semantics without promoting arbitrary page text into trusted model instructions.

### Change

- Captured executable node objectives now use closed, role-based intent rather than capture event IDs.
- Examples: `Activate captured link`, `Enter text in captured textbox`, `Select an option in captured combobox`, `Set captured checkbox to the demonstrated checked state`, `Select captured radio`, and `Submit captured button`.
- Only a closed allowlist of common native roles may enter this trusted objective label. Unknown or site-invented role strings fall back to `captured target`.
- Page-controlled accessible names/text remain available only in the existing deterministic target strategies; they are not copied into the trusted objective string by this slice.
- Navigation objectives remain URL-based because the immutable navigation URL is already the declared browser side effect and verification authority.
- Deterministic selectors, allowed side effects, retry policy, verification contracts, runtime bindings, workflow versioning, and escalation behavior are unchanged.

### Security / tenant isolation / privacy

No tenant/user/profile/credential authority changes. This is compiler metadata derived from an already-authorized capture trace. The new trusted objective label deliberately excludes accessible names, arbitrary text, selectors, captured values, Browser Profile/session identities, BYOK material, cookies, and workload tokens. Unknown roles fail to the generic `captured target` label instead of being interpreted as instructions.

### Idempotency / concurrency / retry / timeout

No run identity, occurrence key, lock, retry budget, lease, heartbeat, schedule, capture claim, or persistence transition changes. Existing bounded retries and semantic-recovery admission remain authoritative. The change should reduce ambiguous recovery prompts without adding model calls or browser work.

### Side-effect verification / user recovery

No browser authority is broadened. Consequential actions retain the exact immutable allowed-side-effect set and existing effect verification. Semantic recovery remains constrained to that action boundary. Human escalation behavior is unchanged.

### Cost / observability

No AWS resource, IAM permission, dependency, Browser/AgentCore allocation, S3 write, model request, queue delivery, or retained Actions artifact is added. The only effect is clearer bounded workflow metadata and less opaque user-facing inspection/recovery intent.

### Regression coverage / validation

Focused compiler coverage proves CLICK, TYPE, SELECT, CHECKBOX, RADIO, and SUBMIT objectives are closed role-based descriptions; capture event IDs and page-controlled accessible names do not appear in trusted objectives; and an unapproved role string falls back to a generic target.

Normal implementation commit: `a145cc802d1c5ffde57409a420183839cdf8d371` (`Clarify compiled capture step intent`). CI #391 stopped exclusively at the deterministic pnpm supply-chain gate before installation or code validation. No package manifest changed. pnpm 10.15.0 regenerated the full reviewed graph from `632f2ffac9f82283280ea3f07fe86ccd00ff820975e412a14b88446bc5401839` to authoritative SHA-256 `9e7dfd36a9d7ed11f6a1693ca19b49e7c465263c57a53db3eb56d104741d259f`.

The single permitted corrective commit authenticates exactly that CI-produced graph and retains the existing DynamoDB/AWS SDK peer-alignment assertions. GitHub Actions on the corrective exact head remains authoritative; this document must not be read as claiming green validation before that run actually completes successfully.

## Known production risks / intentionally parked work

- `main` is still unprotected until an administrator applies/verifies the existing branch-protection helper (or configures an equivalent stronger policy). The deploy workflow correctly issues zero AWS credentials until then.
- Production GitHub Environment restrictions/reviewers remain an independent operational control and must be configured separately.
- VPC AgentCore Browser mode is provisioned/verified, but real route-table, DNS, security-group, NACL, and egress policy still need live validation against private/link-local/control-plane access and redirect/DNS-rebinding scenarios.
- Only OpenAI has a concrete production BYOK reasoning adapter today; core credential routing remains provider-neutral.
- DynamoDB <-> EventBridge Scheduler mutations are fail-closed but not cross-service transactional; operational reconciliation remains a known boundary.
- File/password/miscellaneous controls and native multi-select remain intentionally unsupported until they have explicit deterministic execution and verification semantics.
- Capture compilation remains demonstration-driven and linear. Dynamic task-level decisions beyond constrained UI-drift recovery require an explicit, reviewable authoring contract before broadening normal model authority.

## Next product milestone

1. Promote this slice only after corrective exact-head CI is green.
2. Apply/verify real `main` protection and configure/verify the protected production GitHub Environment.
3. Run the manual immutable AWS deployment and require strengthened live smoke plus all five System capabilities = `CONFIGURED`.
4. Execute the controlled vertical: Cognito/Google -> OpenAI BYOK -> AgentCore Live View capture -> trusted completion/evidence -> Compile/inspect -> guided >30-second Fresh Test -> guided Publish -> Scheduler/SQS/Step Functions/AgentCore -> SES/CloudWatch -> controlled auth expiry -> secure repair/resume -> terminal success.

Concrete live-environment defects should determine subsequent engineering priorities rather than additional recovery micro-hardening.
