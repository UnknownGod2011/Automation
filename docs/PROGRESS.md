# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Detailed historical slices remain available in Git; this file is intentionally consolidated around the current production state and latest product-facing work.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product-facing recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `04d32afaf3636c0df9e58e4f9164dc79c679f084` (`Refresh capture-identity lock snapshot`) is green on GitHub Actions CI #212.
- CI #212 is the authoritative baseline: deterministic lock verification, frozen installation, strict checks/builds, production packaging/deployment contracts, and the full test suite succeeded.
- GitHub Actions on the exact new head remains authoritative. No pass is claimed for the current slice until that exact-head run completes successfully.

## 2026-08-22 — keep Live View available while starting workflow recording

The vertical-path audit found a concrete capture UX blocker. `Open cloud capture` previously redirected the authenticated product tab directly to the AgentCore Live View capability. The user then had to navigate back to the automation page to press `Start recording workflow`; that new navigation could discard the forward-history Live View page, leaving no reliable browser surface in which to demonstrate the workflow after recording began.

Capture startup now returns an ephemeral handoff document instead of redirecting the product tab into Live View. The handoff requires an explicit user click to open Live View in a **separate tab**, while the product/control-plane tab remains available for `Start recording workflow` and `Finish capture`. After recording starts, the user switches back to the still-open Live View tab and demonstrates the reusable workflow.

The Live View URL remains capability material. It is present only in the one-time handoff response body required for the user's browser to open it. It is not placed in the product URL, redirect `Location`, cookie, local storage, DynamoDB, workflow metadata, or application logs. The handoff is `no-store`, uses `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, a restrictive CSP, disabled browser permissions, and `rel="noopener noreferrer"` for the cross-origin Live View tab. Only HTTPS URLs without embedded userinfo are accepted, and URL length is bounded.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- Tenant/user and automation ownership still come from the authenticated control plane; this change only alters how an already-authorized Live View capability is presented to that user's browser.
- Capture session, Browser Profile, provider, BYOK, workload, and durable trace identifiers remain server-owned.
- Starting the underlying capture session remains governed by the existing control-plane/capture idempotency and ownership checks; no new retry loop or background worker was introduced.
- Browser/model execution, effect verification, trace persistence, Browser Profile save-before-completion, and human recovery semantics are unchanged.
- The extra cost is only one small non-cacheable HTML response during interactive capture. No additional AWS resource or API call is added.
- If the Live View URL is malformed/unsafe, capture fails closed back to the existing sanitized `request-failed` notice.

### Validation added

- Web tests prove the handoff is an ordinary `200` response, not a redirect, and does not set cookies.
- Tests require `no-store`, `no-referrer`, `nosniff`, and restrictive CSP headers.
- Tests prove the capability appears only in the escaped response body, never in headers, and that the Live View link opens in a separate `noopener noreferrer` tab.
- Tests reject HTTP, embedded URL credentials, oversized capability URLs, and missing automation identity.
- Exact-head GitHub Actions must still prove strict TypeScript/Next.js builds, packaging/deployment contracts, and the full suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture in a separate tab -> start recording from the product tab -> compile/inspect -> fresh test -> inspect/correct if needed -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
3. Fix concrete defects exposed by that live environment before adding more infrastructure or recovery depth.
4. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations / known risks

- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
