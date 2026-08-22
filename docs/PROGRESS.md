# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical slices remain available in Git; this file is intentionally consolidated around the current production state and latest outward-facing work.

## Product target

sign in with email or Google -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Protected deployment provisions a VPC-mode custom AgentCore Browser and validates its live identity/readiness before application stacks receive browser authority.
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
- Incoming head `8bcc9e71be994301681879719bc846ffdc528560` (`Preserve workflow goal in semantic recovery`) is green on GitHub Actions CI #233.
- This slice adds truthful dashboard next-run visibility. GitHub Actions on the exact new head remains authoritative; no pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — expose truthful next-run visibility on the dashboard

`END_GOAL.md` requires the dashboard to show automation status, next run, last run, and attention state. The current product showed the normalized schedule and last run but omitted the next occurrence entirely. This made a published automation less legible immediately after activation and left a visible gap in the intended product lifecycle.

The web view model now derives a bounded next-run preview from the already-authoritative persisted schedule without adding another scheduler or cloud read path:

- canonical `DAILY` and `WEEKLY` schedules display the next wall-clock occurrence in the configured IANA timezone;
- canonical hourly schedules display an exact next occurrence only when an existing durable scheduled run supplies a trustworthy occurrence anchor;
- an hourly schedule with no scheduled-run anchor says that it runs hourly from scheduler activation rather than inventing an absolute timestamp;
- paused and disabled automations explicitly say that no next run is currently active;
- arbitrary custom cron schedules remain labeled as custom cron rather than pretending a partial cron parser is authoritative;
- malformed/unavailable timezone or canonical schedule previews fail closed to `schedule preview unavailable` instead of showing a wrong time.

The dashboard uses one render-time `Date` for all cards so automations are compared against the same instant during a server render. No scheduler state is mutated and no additional AWS API call is made.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** the preview uses only already-sanitized schedule metadata and run summary timestamps. It does not expose Scheduler resource IDs, tenant/user identifiers, Browser Profile state, credentials, workload tokens, or browser contents.
- **Tenant isolation:** unchanged. Dashboard automations and last-run summaries still come from the authenticated tenant/user-scoped control plane; the preview performs no independent data lookup.
- **Idempotency/concurrency:** unchanged. This is presentation-only and does not create runs, touch Scheduler, or alter occurrence keys/automation leases.
- **Retry/timeout:** unchanged. No network call or retry loop is added.
- **Side-effect verification:** unchanged. Browser execution and verification semantics are untouched.
- **Cost:** effectively zero additional cloud cost; calculation uses `Intl.DateTimeFormat` in the Next.js server render.
- **Observability:** users gain the previously missing next-run status without adding logs or metric dimensions.
- **User recovery:** paused/disabled states are clearer; attention/recovery behavior itself is unchanged.

### Validation added

- canonical daily next occurrence in `Asia/Kolkata`, including next-day rollover after the scheduled minute;
- canonical weekly next occurrence;
- hourly preview anchored only to a durable `SCHEDULED` run, never a Fresh Test;
- conservative hourly activation message when no occurrence anchor exists;
- paused and disabled labels;
- custom cron no-false-precision behavior;
- invalid timezone fail-closed behavior;
- unpublished automation remains `not scheduled`.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, provisions the VPC custom AgentCore Browser, deploys application stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> dashboard next-run visibility -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> automatically observed durable Fresh Test result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for this dashboard next-run slice; fix only root-caused failures without weakening checks.
2. Run the protected deployment workflow with real VPC subnet/security-group IDs; require Browser creation/readiness validation and the live public/auth smoke gate to pass.
3. Validate the live Browser network path against private/link-local/control-plane destinations after DNS resolution and redirects. If VPC routing/security groups alone cannot enforce the required separation, add an explicit egress proxy/firewall or domain allowlist before broad arbitrary-host production use.
4. Exercise a Fresh Test intentionally lasting more than 30 seconds and verify prompt acceptance, background AgentCore execution, bounded polling, and durable final status without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> confirm dashboard next-run preview -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- The dashboard preview is intentionally not a replacement for EventBridge Scheduler authority. Canonical daily/weekly expressions can be previewed exactly from their wall-clock semantics, while arbitrary cron expressions remain non-evaluated. Hourly exactness requires a durable scheduled-run anchor because the product does not persist a separate Scheduler activation timestamp.
- VPC Browser mode is deployment-enforced, but the repository cannot prove an environment's route tables, DNS controls, security groups, network ACLs, firewall/proxy behavior, or redirect-time destination resolution without live AWS validation. Do not treat `networkMode=VPC` by itself as complete SSRF containment.
- Changing Browser VPC networking can require replacement of the custom Browser; Browser Profile compatibility must be validated during real environment migrations.
- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain cross-process authority. Harden only if live Runtime replacement demonstrates a concrete defect.
- Fresh Test page polling is bounded to five minutes; longer tests remain valid and can be followed through manual refresh/run diagnostics.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
