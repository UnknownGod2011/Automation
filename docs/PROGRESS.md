# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical implementation detail remains available in Git; this file records the current production state, latest validated head, current slice, risks, and next milestones.

## Product target

sign in with email or Google -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Protected deployment provisions a VPC-mode custom AgentCore Browser and validates live identity/readiness before application stacks receive browser authority.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Long-running Fresh Tests are acknowledged asynchronously and the page follows durable run state with bounded polling.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Scheduled execution checkpoints are seeded before browser startup from immutable graph variables, bounded persisted non-secret scheduled capture inputs, and any explicit invocation override.
- Optional Google federation preserves `email_verified` into Cognito, and the controlled demo includes read-only live-user verification before Google-backed SES evidence is trusted.
- Semantic recovery receives both the immutable workflow goal and current constrained step while allowed actions remain node-bounded.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `b3bf3ecd0aa29b0170783d6f5d55a99d6a7e2fa4` (`Refresh dashboard lock snapshot`) is green on GitHub Actions CI #235.
- CI #235 is authoritative for that exact incoming head: deterministic lock verification, frozen installation, strict checks/builds, production packaging/deployment contracts, and the full test suite completed successfully.
- The current slice changes only the Next.js presentation view model/tests plus this progress record. Exact-head GitHub Actions remains authoritative; no pass is claimed for the new head until it exists.

## 2026-08-22 — make dashboard lifecycle status truthful

The dashboard's status badge was collapsing multiple durable automation states into misleading labels. In particular, any automation with a published workflow version could display `Published` even when its durable state was `PAUSED` or `DISABLED`. `READY_TO_TEST` and `READY_TO_PUBLISH` also appeared as generic `Draft`, hiding where the user actually was in the product lifecycle.

The web view model now maps the durable automation state directly into a user-facing lifecycle label:

- `DRAFT` -> Draft
- `CAPTURING` -> Capturing
- `COMPILING` -> Compiling
- `READY_TO_TEST` -> Ready to test
- `TESTING` -> Testing
- `READY_TO_PUBLISH` -> Ready to publish
- `ACTIVE` -> Published
- `RUNNING` -> Running
- `PAUSED` -> Paused
- `NEEDS_AUTH` -> Needs sign-in
- `NEEDS_API_KEY` -> Needs API key
- `NEEDS_ATTENTION` -> Needs attention
- `DISABLED` -> Disabled

The existing sanitized `needsAttention` flag still takes precedence so a durable attention state is never hidden by a nominal lifecycle label.

### Review

- **Security / tenancy:** presentation-only. It consumes the authenticated, sanitized automation summary already returned by the control plane and exposes no new identifiers, credentials, browser state, or tenant data.
- **Idempotency / concurrency:** no state mutation, run creation, Scheduler operation, or lock behavior changes.
- **Retry / timeout / verification:** unchanged; no browser/model/network work added.
- **Cost:** effectively zero additional cloud cost; mapping is local to the Next.js render.
- **Observability / recovery:** the user can now distinguish inactive/paused/disabled and pre-publish states correctly before taking action. Recovery authority remains unchanged.

### Validation added

- every durable automation status has an explicit expected product label;
- published `PAUSED` and `DISABLED` automations can no longer render as `Published`;
- `READY_TO_TEST` and `READY_TO_PUBLISH` no longer collapse to `Draft`;
- `needsAttention` continues to override the nominal lifecycle label.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, provisions the VPC custom AgentCore Browser, deploys application stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> truthful dashboard lifecycle/next-run visibility -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test -> publish with schedule/non-secret recurring inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for this lifecycle-status slice; if CI is red, root-cause the real failure before any corrective commit and do not weaken checks.
2. Run the protected deployment workflow with real VPC subnet/security-group IDs; require Browser creation/readiness validation and live public/auth smoke to pass.
3. Validate the live Browser network path against private/link-local/control-plane destinations after DNS resolution and redirects; add an explicit egress proxy/firewall or domain allowlist if VPC policy alone cannot enforce separation.
4. Exercise a Fresh Test intentionally lasting more than 30 seconds and verify prompt acceptance, background AgentCore execution, bounded polling, and durable final status without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> confirm lifecycle and next-run display -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Dashboard labels and next-run preview are presentation, not Scheduler authority.
- VPC Browser mode is deployment-enforced, but route tables, DNS controls, security groups, NACLs, firewall/proxy behavior, and redirect-time resolution still require live AWS validation before treating it as complete SSRF containment.
- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain cross-process authority. Harden only if live Runtime replacement demonstrates a defect.
- Fresh Test polling is bounded to five minutes; longer tests remain valid through manual refresh/run diagnostics.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous smoke are not substitutes for the authenticated lifecycle.
- Capture structural verification is intentionally coarse/content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Multi-artifact S3 release upload is not transactional. Partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
