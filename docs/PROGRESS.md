# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening. Historical slices remain available in Git; this file is intentionally consolidated around the current production state and the latest outward-facing work.

## Product target

sign in with email or Google -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> inspect semantic plan -> fresh cloud test -> inspect/correct -> approve -> recurrence/timezone + scheduled inputs -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed production foundation

- Deterministic pnpm/Node/TypeScript dependency strategy with frozen installs; the known AWS SDK peer mismatch was resolved rather than suppressed.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts, capture contracts/compiler, and a local/mock end-to-end lifecycle.
- Next.js/Cognito control plane with create/capture/compile/inspect/fresh-test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View capture, long-running capture collection, AgentCore Identity BYOK, OpenAI reasoning, fresh/scheduled AgentCore execution, EventBridge Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, hosted Next.js Lambda, and GitHub OIDC deployment.
- Live capture emits explicit effect-verification contracts so captured side effects remain compilable without weakening verification-before-success.
- Server-owned workflow/trace/fresh-test/publish/capture identities remove internal durable IDs from ordinary user input.
- Fresh-test results are distinguished from scheduled runs and feed an explicit inspect/correct/retest loop. Long-running Fresh Tests are acknowledged asynchronously and the page follows durable status with bounded polling.
- Publishing requires a successful `FRESH_TEST` for the latest immutable workflow version; successful scheduled/legacy runs do not authorize publication.
- Product recurrence input is normalized into validated EventBridge `rate(...)` / `cron(...)` expressions before Scheduler mutation.
- Scheduled execution checkpoints are seeded before browser startup from immutable graph variables, bounded persisted non-secret scheduled capture inputs, and any explicit invocation override.
- Optional Google federation preserves `email_verified` into Cognito, and the controlled demo includes a read-only verification command before Google-backed SES evidence is trusted.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a demonstrated vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `9bb611362739b731e531fe84959765fd57517811` (`Follow asynchronous Fresh Test results`) is green on GitHub Actions CI #229.
- This slice adds a provider-neutral public-target URL policy before cloud Browser Profile allocation. GitHub Actions on the exact new head remains authoritative; no pass is claimed until deterministic lock verification, frozen install, strict type/build checks, production packaging/deployment contracts, and the full test suite complete successfully.

## 2026-08-22 — block explicit internal-network automation targets before cloud allocation

A pre-deployment security review found that automation creation accepted any syntactically valid HTTP(S) URL, including `localhost`, RFC1918/private IPv4 literals, link-local cloud metadata addresses, local/internal hostnames, and local IPv6 addresses. Because the stored website becomes navigation authority for AgentCore Browser capture and execution, an authenticated user could otherwise direct the cloud browser toward infrastructure-local services.

The provider-neutral lifecycle now validates the target before creating the automation Browser Profile. The application-layer policy rejects embedded URL credentials, localhost/local/home-arpa and single-label hosts, Google metadata hostnames, non-public/reserved IPv4 literals including RFC1918/loopback/link-local/CGNAT/documentation/benchmark/multicast ranges, and local/link-local/multicast/documentation/IPv4-mapped IPv6 literals. Public HTTP(S) hostnames and public IP literals continue to normalize through the standard URL parser.

The same policy is reused when validating persisted capture-trace website identity, preventing a trace from reintroducing an explicit target that the draft boundary would not accept.

### Review: security, tenancy, idempotency, concurrency, retry, verification, cost, observability, recovery

- **Security:** explicit internal/private target authority is rejected before Browser Profile allocation. Embedded URL credentials are also rejected so userinfo cannot become persisted website metadata. This is a first application-layer SSRF boundary, not a claim of complete SSRF containment.
- **Tenant isolation:** unchanged. Website policy is independent of ownership; all automation and execution state remains tenant/user scoped.
- **Idempotency/concurrency:** unchanged. Invalid targets never reach profile allocation or durable automation creation, so they create no competing resource identity.
- **Retry/timeout:** no retry or network lookup was introduced. Validation is deterministic and local.
- **Side-effect verification:** unchanged. The execution engine still requires declared verification before success.
- **Cost:** invalid/private targets fail before Browser Profile creation, avoiding unnecessary cloud resource allocation. Valid requests add only local parsing/range checks.
- **Observability:** failures surface through the existing sanitized bad-request/control-plane boundary; no target credentials or internal provider errors are added to logs/telemetry.
- **User recovery:** invalid targets are corrected at creation time rather than becoming failed cloud runs. Existing browser takeover/resume behavior is unchanged.

### Validation added

- Unit coverage accepts normal public hostnames plus public IPv4/IPv6 targets and rejects non-HTTP protocols and credential-bearing URLs.
- Table-driven coverage rejects localhost/local/home-arpa/metadata hostnames, single-label internal names, private/link-local/CGNAT/documentation/benchmark/multicast IPv4 ranges, and loopback/ULA/link-local/documentation/multicast IPv6 ranges.
- Lifecycle regression coverage proves rejected targets do not call `BrowserProfileStore.create`, keeping cloud allocation behind target validation.

### Residual network-security boundary

Application parsing cannot prevent DNS rebinding, a public hostname later resolving to a private address, or an allowed page redirecting/navigation to an internal address. Before broad arbitrary-site production exposure, the AgentCore Browser/runtime network path still needs a deployment-enforced DNS/egress/redirect policy (or a justified domain allowlist) that blocks private/link-local/control-plane destinations at connection time. Do not weaken this application guard; treat runtime network enforcement as the second layer.

## Current release/deployment state

The repository has deterministic production packages for AgentCore Runtime, control-plane/capture/dispatcher Lambda entrypoints, and the Next.js standalone Lambda. Release artifacts are uploaded create-only to a versioned S3 bucket and deployed by exact `VersionId`. The protected deployment workflow validates source before acquiring short-lived AWS credentials through GitHub OIDC, deploys stacks in dependency order, retains no GitHub Actions artifacts, and runs a public/auth-boundary smoke after deployment.

The intended AWS path is: Cognito email or optional Google sign-in -> BYOK -> Live View capture -> compile/inspect -> AgentCore Fresh Test submission -> automatically observed durable Fresh Test result -> publish with schedule + explicitly non-secret recurring capture inputs -> EventBridge scheduled dispatch -> AgentCore Browser/OpenAI execution -> verification -> semantic run history/SES -> bounded human attention -> secure target-auth takeover/resume.

## Next product milestones

1. Require exact-head CI for this target-policy slice; fix only root-caused failures without weakening checks.
2. Run the protected deployment workflow and require the live public/auth smoke gate to pass against a real AWS environment.
3. Before enabling arbitrary untrusted target hosts broadly, verify the live AgentCore Browser/runtime network boundary blocks private/link-local/control-plane destinations after DNS resolution and redirects; if the managed service cannot guarantee that, add a deployment-level allowlist/egress enforcement boundary.
4. Exercise a Fresh Test that intentionally runs longer than 30 seconds and verify the request returns promptly, the page follows durable run state, and the final result appears without manual refresh.
5. Execute the controlled interactive vertical demo from `outputs.webOrigin`: sign in -> BYOK -> Live View capture -> compile/inspect -> Fresh Test -> publish -> scheduled execution -> semantic diagnostics/history/email -> target-auth takeover/resume.
6. Fix concrete defects exposed by the live environment before adding more infrastructure or recovery depth.
7. Add Google cloud execution adapters only after the AWS vertical slice is demonstrated; Google identity federation is independent of that future provider adapter.

## Parked limitations / known risks

- Application-layer target validation blocks explicit private/local hosts but cannot by itself stop DNS rebinding or redirect-to-private behavior; runtime egress/DNS enforcement remains required for comprehensive SSRF containment.
- Background Fresh Test duplicate suppression is process-local; durable run occurrence identity and the automation lease remain the cross-process authority. Harden only if live Runtime replacement demonstrates a concrete duplicate-start defect.
- Fresh Test page polling is bounded to five minutes; longer tests remain valid and can be followed through manual refresh/run diagnostics.
- Live OpenAI, SES, Cognito, AgentCore Browser/Profile/Runtime behavior still requires real AWS validation; deterministic CI and anonymous deployment smoke are not substitutes for a real authenticated lifecycle.
- Google federation still requires a real Google OAuth web client and a Secrets Manager secret; CI validates infrastructure/tooling but cannot prove a live external OAuth exchange without deployment-owned credentials.
- Capture structural verification is intentionally coarse and content-redacted. Highly dynamic pages may require recapture or a future explicit user-authored effect assertion; do not silently weaken verification.
- Plaintext scheduled non-secret inputs intentionally solve only reusable non-secret captured typing. Secret recurring values need a separate vault-reference resolver before they are schedulable.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current lifecycle ordering fails closed and live deployment should validate reconciliation behavior before additional hardening.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
