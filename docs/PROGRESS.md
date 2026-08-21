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
- Server-owned workflow/trace/fresh-test/publish identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product-facing recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head before this slice was `4543955c218d649fd8575607e070df9f8213d80d` (`Refresh publish-gate lock snapshot`), green on GitHub Actions CI #210.
- Product commit `5b0a11d993900cef50c032dbeedf43adc54ef940` (`Keep capture session identity server-owned`) triggered CI #211.
- CI #211 stopped only at the deterministic pnpm lock-snapshot gate before install/type-check/tests. No package manifest changed. pnpm 10.15.0 resolved 376 packages and produced snapshot SHA-256 `88d75541e6b949325278dadfecef1400c82b0fe921ef0ea3edf8b8606f5eecda` instead of the previously reviewed `8625718ffa4ad21010a4da1601095b866b14cd4bf6ef1a614865ec34b0b1faff`.
- The existing AWS DynamoDB peer-alignment assertions remain intact. The corrective commit authenticates exactly the CI-generated graph; GitHub Actions on that exact corrective head is authoritative and no pass is claimed until it completes successfully.

## 2026-08-22 — make active capture identity server-owned in the web product

The vertical-path audit found one remaining internal-identity seam in the authenticated capture UX. Start/Finish capture forms carried the opaque `captureSessionId` from rendered page state back to the Next.js mutation route. The provider-neutral control plane already revalidated that ID against the current tenant/user/automation session, so this was not an ownership bypass, but the browser did not need to choose the identifier at all.

The Next.js mutation route now reloads current authenticated capture-recording state and resolves the active capture session server-side before issuing Start/Finish. Browser-submitted capture IDs are no longer execution authority and the rendered forms no longer contain the capture-session ID. Start remains replay-safe if the durable capture is already in `WORKFLOW`, but is suppressed after finish is requested. Finish is rejected before `WORKFLOW` so authentication setup cannot accidentally become the demonstrated workflow; exact finish replay remains allowed.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- Tenant/user ownership remains derived from authenticated control-plane context and is independently revalidated by the core capture service.
- Capture-session, Browser Profile, browser-session, provider, BYOK, and workload identifiers remain server-side.
- Duplicate Start/Finish delivery retains the existing durable idempotency semantics; no capture worker, retry loop, lease, recovery record, browser/model behavior, or cloud resource changed.
- The only added runtime cost is one authenticated current-capture read per interactive Start/Finish mutation.
- Effect verification, trace persistence, Browser Profile save-before-completion ordering, and trusted capture-completion authority are unchanged.
- User recovery remains refresh/retry against the currently active durable capture state.

### Validation added

- Web tests cover no-active-capture rejection, trusted AUTH_SETUP start, finish-before-WORKFLOW rejection, replay-safe Start/Finish behavior, finish-requested suppression of Start, and malformed server capture identities.
- The mutation route no longer reads `captureSessionId` from form data.
- The automation page no longer renders hidden capture-session inputs for Start/Finish.
- CI #211 did not exercise these tests because dependency verification failed first; the corrective exact-head run must prove frozen install, strict checks/builds, packaging/deployment contracts, and the full test suite.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended production AWS path is: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore fresh test -> publish -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Run the protected deployment workflow and require the live public/auth smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture -> compile/inspect -> fresh test -> inspect/correct if needed -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume.
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
