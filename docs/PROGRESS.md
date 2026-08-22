# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical slices remain available in Git; this file is intentionally consolidated around the current production state and latest outward-facing work.

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
- Incoming product head `d0de9613b7a5d7ea66eadba2f7cd81ad5e8fa4ea` (`Show next scheduled run on dashboard`) reached CI #234.
- CI #234 stopped at the deterministic pnpm supply-chain gate before install/type-check/tests. No package manifest changed; pnpm 10.15.0 regenerated the full lock graph from reviewed SHA `cc944aae73f2f4aee20674a8156274abbdc6d63b6fb55a2dca46d434aecd4ec7` to authoritative SHA `00456e6d43e48cfb385db6eb7ba1afeb1543a6e79b051b61f72e76851d1ecabd`.
- The single corrective commit authenticates only that exact CI-produced snapshot and retains the explicit DynamoDB/util-DynamoDB peer-alignment assertions. Exact-head GitHub Actions remains authoritative; no green claim is made until frozen install, `pnpm check`, packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — expose truthful next-run visibility on the dashboard

`END_GOAL.md` requires the dashboard to show automation status, next run, last run, and attention state. The current product showed the normalized schedule and last run but omitted the next occurrence. The web view model now derives a bounded next-run preview from already-sanitized persisted schedule/run-summary data without adding another scheduler or AWS read path.

Behavior is intentionally conservative:

- canonical `DAILY` and `WEEKLY` schedules show the next wall-clock occurrence in the configured IANA timezone;
- canonical hourly schedules show an exact timestamp only when an existing durable `SCHEDULED` run provides a trustworthy occurrence anchor;
- hourly schedules without that anchor say `hourly from scheduler activation` rather than inventing an absolute time;
- paused and disabled automations explicitly show that no next run is currently active;
- arbitrary custom cron remains labeled as custom cron rather than being interpreted by a partial cron engine;
- invalid timezone/canonical preview state fails closed to `schedule preview unavailable` rather than showing a wrong time.

The dashboard uses one server-render timestamp for all automation cards. Scheduler state is not mutated and no extra cloud API call is made.

### Review

- **Security / tenancy:** only authenticated, already-sanitized schedule metadata and scheduled-run timestamps are used. No tenant IDs, Scheduler resource IDs, Browser Profiles, credentials, tokens, or browser contents are exposed.
- **Idempotency / concurrency:** presentation-only; run creation, occurrence keys, automation leases, and Scheduler authority are unchanged.
- **Retry / timeout:** no network call or retry loop added.
- **Side-effect verification:** unchanged.
- **Cost:** effectively zero additional cloud cost; computation stays inside the Next.js server render.
- **Observability / recovery:** users gain the missing next-run state and clearer paused/disabled status; recovery behavior is unchanged.

### Validation added

- canonical daily next occurrence in `Asia/Kolkata`, including next-day rollover;
- canonical weekly next occurrence;
- hourly preview anchored only to a durable scheduled run and never a Fresh Test;
- conservative hourly activation message when no anchor exists;
- paused/disabled labels;
- custom-cron no-false-precision behavior;
- invalid-timezone fail-closed behavior;
- unpublished automation remains `not scheduled`.

## CI #234 root cause and corrective boundary

The dashboard slice changed no dependency manifest. CI #234 nevertheless regenerated a different full pnpm lock snapshot, which is expected to stop the build under the repository's fail-closed supply-chain policy. The Actions log showed normal resolution and the same pinned pnpm version before reporting only the SHA mismatch. Installation and code checks were correctly skipped. The corrective change updates only the reviewed lock fingerprint to `00456e6d43e48cfb385db6eb7ba1afeb1543a6e79b051b61f72e76851d1ecabd`; the existing AWS SDK peer-alignment checks remain unchanged.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, provisions the VPC custom AgentCore Browser, deploys application stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> dashboard next-run visibility -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test -> publish with schedule/non-secret recurring inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for the corrective lock-snapshot head; fix only a root-caused code/test failure if one appears, without weakening checks.
2. Run the protected deployment workflow with real VPC subnet/security-group IDs; require Browser creation/readiness validation and live public/auth smoke to pass.
3. Validate the live Browser network path against private/link-local/control-plane destinations after DNS resolution and redirects; add an explicit egress proxy/firewall or domain allowlist if VPC policy alone cannot enforce separation.
4. Exercise a Fresh Test intentionally lasting more than 30 seconds and verify prompt acceptance, background AgentCore execution, bounded polling, and durable final status without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> confirm next-run preview -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Dashboard next-run preview is presentation, not Scheduler authority. Canonical daily/weekly expressions can be previewed from wall-clock semantics; arbitrary cron is deliberately not evaluated. Hourly exactness requires a durable scheduled-run anchor because no separate Scheduler activation timestamp is persisted.
- VPC Browser mode is deployment-enforced, but route tables, DNS controls, security groups, NACLs, firewall/proxy behavior, and redirect-time resolution still require live AWS validation before treating it as complete SSRF containment.
- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain cross-process authority. Harden only if live Runtime replacement demonstrates a defect.
- Fresh Test polling is bounded to five minutes; longer tests remain valid through manual refresh/run diagnostics.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous smoke are not substitutes for the authenticated lifecycle.
- Capture structural verification is intentionally coarse/content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Multi-artifact S3 release upload is not transactional. Partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
