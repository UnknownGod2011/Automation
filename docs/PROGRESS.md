# Progress Log

Read `END_GOAL.md`, `ARCHITECTURE.md`, and `QUALITY_GATES.md` before material changes. Product completion takes precedence over narrower recovery hardening.

## Product target

sign in -> dashboard -> create -> cloud capture -> persisted Browser Profile + trace -> compile semantic WorkflowGraph -> fresh cloud test -> approve -> recurrence/timezone -> publish -> scheduled cloud run -> deterministic/reasoned browser execution -> verification -> history/email -> bounded failure -> human takeover/resume.

## Completed foundation

- Deterministic pnpm/Node/TypeScript build and frozen dependency graph; AWS SDK peer mismatch resolved.
- Provider-neutral workflow/run/retry/verification/checkpoint contracts plus local/mock end-to-end lifecycle.
- Next.js/Cognito control plane, capture/compile/test/publish UX, BYOK management, schedule controls, sanitized run diagnostics, explicit HUMAN continuation, target-auth takeover, and post-resume reporting.
- AWS DynamoDB/S3 persistence, AgentCore Browser/Profile/Live View + long-running capture, AgentCore Identity BYOK, OpenAI reasoning, AgentCore fresh/scheduled execution, Scheduler/SQS/Step Functions, SES/CloudWatch, immutable release packaging, ordered deployment, and GitHub OIDC.
- Deep human-resume claim/lease/heartbeat/reconciliation machinery exists and remains parked unless a real vertical defect requires it.

## Incoming validation

- PR #1 is the open draft on `agent/bootstrap-platform`.
- Incoming head `e0c5c156265756f37964a400a3b2eaf23b5312e4` (`Refresh deterministic pnpm lock snapshot`) is green on CI #203.
- GitHub Actions on the exact new head remains authoritative; no new pass is claimed before it exists.

## 2026-08-21 — server-owned publish workflow selection

The remaining approval UX asked the user to type a workflow-version number even though workflow versions are internal immutable state. This slice removes that browser-controlled value. The authenticated Next.js server now resolves the publish candidate from durable successful run history only when the automation is `READY_TO_PUBLISH`, and the browser submits only recurrence, schedule expression, and timezone.

The existing provider-neutral lifecycle remains the final authority: publish still requires `READY_TO_PUBLISH`, loads the requested immutable workflow version, and rejects it unless it is the latest workflow. Compiling a newer version moves the automation back to `READY_TO_TEST`, while a successful fresh test is what returns it to `READY_TO_PUBLISH`. The web resolver is therefore a convenience/security boundary, not a replacement for lifecycle validation.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability / recovery

- Tenant/user ownership remains Cognito/control-plane derived. The browser cannot choose a workflow version, trace, run ID, tenant, or user for publication.
- The resolver considers only successful durable run summaries and refuses to produce a candidate unless the automation is currently `READY_TO_PUBLISH`; malformed/non-positive versions are ignored.
- The lifecycle's latest-version check remains defense in depth. Stale or inconsistent run-history state cannot force publication of an older graph.
- Publication still uses the existing Scheduler upsert and durable automation transition; no retry, execution, Browser, model, recovery, IAM, dependency, or cloud-resource behavior changed.
- The publish POST adds two authenticated reads (automation summary and run history) before the existing mutation. This is bounded control-plane cost and avoids trusting an internal identifier from the browser.
- The automation page hides the publish form until trusted state proves a successful test is available, while the POST handler re-resolves that state so stale rendered pages cannot bypass the gate.

### Validation added

- Web unit coverage proves the server resolver chooses the highest successful immutable version only in `READY_TO_PUBLISH`, ignores failed runs, and returns no candidate for untested state.
- The Next.js production build remains the integration gate for removal of the workflow-version form field and server-side publish resolution.
- Exact-head GitHub Actions after publication is authoritative.

## 2026-08-21 — server-owned compile and fresh-test identities

The product-flow audit found a user-facing identity leak in the otherwise server-owned control plane: the automation page still asked users to type a `Workflow ID` before compilation and a `Run ID` before every fresh test, and the browser submitted the latest capture trace ID as a hidden form field. These are internal durable identifiers, not meaningful user choices, and letting the browser choose them creates avoidable collision/stale-selection failure modes in the real vertical demo.

This slice keeps the existing provider-neutral lifecycle contracts unchanged while moving those choices behind the authenticated Next.js server boundary. Compile now resolves the latest completed capture from the authenticated automation summary immediately before dispatch, uses the authenticated automation ID as the stable workflow identity, and sends no trace/workflow identifier from the browser form. Fresh test now generates a UUID-based run identity server-side for each request; the user supplies only optional runtime variables.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability / recovery

- Tenant/user ownership remains derived from Cognito/authenticated control-plane context. The browser no longer gets to choose a stale/foreign capture trace for compile or an arbitrary durable fresh-test run key.
- Workflow identity is deterministic for one automation and does not contain credentials or Browser/Profile state. Fresh-test identities are bounded `test-<uuid>` values and remain visible only where run history already intentionally exposes run correlation IDs.
- The server resolves the latest completed capture at command time. If no completed capture exists, compile fails before lifecycle compilation rather than accepting a client-provided trace ID.
- Each intentional fresh-test submission receives a new run ID, avoiding the old default `test-<automationId>` collision that could turn a second legitimate test into a duplicate of the first. The existing run repository remains the durable duplicate authority if transport delivery itself is replayed downstream.
- No browser/model retry, scheduling, checkpoint, verification, recovery, IAM, dependency, or cloud-resource semantics changed.
- Compile adds one authenticated automation-summary read before the existing compile mutation. This is small compared with capture/browser/model cost and keeps internal trace selection out of the client.

### Validation added

- Web tests cover stable server-owned workflow identity, bounded UUID-based fresh-test IDs, and invalid identity rejection.
- The Next.js production build remains the integration gate for the updated command route and automation page.
- Exact-head GitHub Actions after publication is authoritative.

## 2026-08-21 — live capture effect-verification bridge

The vertical-slice audit found a concrete product blocker before live deployment: the production AgentCore/Playwright capture collector emitted `CLICK`, `INPUT`, and `SUBMIT` events without `expectedEffect`, while the provider-neutral compiler correctly refuses to compile side-effecting events that do not have an explicit verification contract. A real Live View teaching session could therefore complete and persist successfully but still be impossible to compile.

This slice closes that seam without weakening `assertWorkflowGraph` or inventing a new provider-neutral verification mode. Capture-generated effects use the existing `CUSTOM` boundary with a tightly namespaced AWS contract. Input events receive `capture:input-filled`; the runtime resolves the same immutable node target after typing and verifies that the field is non-empty without persisting the value. Click/submit events wait a bounded settle interval and record a `capture:state:*` digest derived from the post-action URL origin/path plus bounded structural DOM markers. The runtime recomputes that same redacted structural digest after replay and verifies equality.

If post-action state cannot be observed during capture, the collector deliberately omits `expectedEffect`; compilation then continues to fail closed rather than manufacturing verification. Capture-event sequence identities are reserved at observation time and asynchronous post-effect probes are drained before the final trace is returned, so delayed verification capture cannot reorder workflow events.

### Security / tenancy / idempotency / concurrency / retry / timeout / cost / observability / recovery

- The structural digest excludes page text, form values, query strings, URL fragments, cookies, storage, and raw DOM. Structural identifiers exist only transiently inside the capture worker and only the stable digest is persisted as verification evidence.
- Raw typed values remain excluded from the capture trace and continue to become sensitive runtime-variable placeholders. `capture:input-filled` checks only non-empty state and never serializes the entered value.
- TYPE execution already suppressed its action screenshot; this slice also suppresses the subsequent verification screenshot for TYPE nodes, closing the adjacent path that could otherwise persist user-entered secrets after a successful fill.
- The custom verifier recognizes only the two `capture:*` contracts above. Unknown `CUSTOM` verification remains `NOT_CONFIGURED`; MODEL verification remains separate and fail-closed.
- Tenant/user authority is unchanged. Verification operates only inside the already-scoped AgentCore browser runtime and adds no repository, IAM, cross-tenant lookup, BYOK access, or user-controlled cloud identity.
- The settle delay and verification polling are bounded by explicit millisecond limits and existing node verification timeouts. No new workflow retry layer or duplicate browser-action dispatch is added.
- Cost impact is bounded to one small structural DOM observation after captured click/submit actions and bounded structural comparisons during verification. No screenshot is added for typed values.
- A mismatch remains an ordinary `EFFECT_NOT_VERIFIED` path, preserving existing retry/human-attention behavior rather than introducing another recovery subsystem.

### Validation added

- Capture tests prove live INPUT events receive a compilable explicit verification contract while raw typed values remain absent.
- Capture tests prove click events receive a redacted structural digest and reject invalid settle configuration before browser work.
- Compiler regression coverage proves the capture-generated `CUSTOM` contracts survive compilation without weakening the side-effect verification gate.
- Playwright verification tests prove non-empty input verification, structural-state verification, rejection of unknown CUSTOM contracts, and no verification screenshot for TYPE nodes.
- Exact-head GitHub Actions after publication is authoritative.

## 2026-08-21 — live AWS deployment smoke gate

The repository is ready for a controlled live deployment, but CloudFormation success alone does not prove that the user-facing web function was finalized with the real Cognito/control-plane outputs or that the public authentication boundaries behave correctly. This slice adds `scripts/smoke-aws-deployment.sh` and runs it immediately after the ordered deployment in the protected GitHub OIDC workflow.

The live smoke uses only public/anonymous requests. It verifies that the deployed web origin returns the real signed-out product shell rather than the bootstrap `NOT_CONFIGURED` state; that `/api/auth/sign-in` redirects to the exact deployed Cognito domain with authorization-code flow, PKCE S256, required scopes, state, and the exact deployed callback URL; that the Cognito/JWT-protected control-plane API rejects an anonymous request; and that the IAM-only capture-completion endpoint also rejects an unsigned anonymous request.

### Security / tenancy / idempotency / concurrency / retry / cost / observability

- The smoke test has no user access token, refresh token, BYOK key, browser credential, Browser Profile reference, workload token, or target-site session. It cannot create/mutate an automation or execute browser/model work.
- URLs come only from the deployment result produced from CloudFormation outputs and are revalidated as HTTPS with no embedded credentials before any request.
- Redirect following is not needed for the OAuth assertion; the Cognito `Location` header is inspected directly, reducing accidental credential/cookie propagation to another origin.
- Anonymous control-plane and capture-completion probes must remain `401/403`; a `2xx`, route-missing `404`, or unexpected server response fails deployment smoke instead of being normalized.
- Network calls use bounded connect/overall timeouts and HTTPS-only protocol restrictions. There is no retry loop, so an unhealthy deployment is surfaced directly to the operator rather than hidden by repeated traffic.
- Cost impact is negligible: one web GET, one sign-in redirect request, and two rejected API requests per deployment. No AgentCore Browser/model/Scheduler execution is started.
- The deployment workflow still retains no GitHub Actions artifacts; smoke output is limited to fixed status text and never prints response bodies or headers.

### Validation added

- `scripts/test-smoke-aws-deployment.sh` uses a fake `curl` implementation, requiring no cloud credentials. It proves the healthy public boundary, rejection of non-S256 OAuth redirects, and rejection of insecure deployment origins.
- CI #199 passed deterministic lock verification, frozen installation, strict `pnpm check`, all three production package builds, web hosting, release, deployment-ordering, and web-demo environment contracts before failing only in the new smoke fixture. The fake `curl` wrote the expected product HTML and then incorrectly truncated its own output file, causing the product-shell assertion to fail. Production smoke behavior was not implicated.
- The corrective change removes only that fixture truncation; no production code or validation condition is weakened. Exact-head GitHub Actions after publication remains authoritative.
- The protected deployment workflow runs the real smoke only after the immutable release and ordered stack deployment have succeeded.

## 2026-08-21 — AWS-hosted Next.js web deployment

The remaining real-demo blocker was the lack of a reproducible public Next.js origin. The existing app already emitted Next.js standalone output, so this slice adds `package-web-lambda.sh` and deploys that artifact through `infra/aws/web-app.yaml` using AWS Lambda Web Adapter v1.0.1 layer 28 (Apache-2.0).

The release manifest now contains a third immutable, versioned S3 artifact for the web application. Ordered deployment performs a two-phase web rollout: create the web Lambda/Function URL with empty app configuration, derive the exact HTTPS origin, use that origin for Cognito callback/logout configuration, deploy the execution/control plane, then update the same web function with the trusted control-plane URL, Cognito domain/client ID, and canonical origin. This removes the external-hosting prerequisite without a callback-URL dependency cycle.

### Security / tenancy / idempotency / concurrency / retry / cost / observability

- The web Lambda role can write only its own CloudWatch log stream; it has no DynamoDB/S3/AgentCore/Identity/Scheduler/SES execution permissions.
- The Function URL is intentionally public because it serves the sign-in UI. User actions still require Cognito cookies and the backend control-plane API remains JWT protected.
- AWS's post-October-2025 Function URL model requires both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`; the latter is constrained with `InvokedViaFunctionUrl`.
- Reserved concurrency is bounded (default 5) to cap public-endpoint compute exposure. No retry loop or workflow authority is added.
- Web code is version-pinned through the same create-only/versioned S3 release boundary as the runtime/control-plane ZIPs.
- Environment files are explicitly removed from the packaged standalone tree. Deployment configuration contains public coordinates only.
- Packaging adds no npm dependency; Lambda Web Adapter is an official AWS-maintained Apache-2.0 deployment extension pinned to layer version 28.

### Validation added

- CI builds the real Next.js standalone Lambda ZIP and verifies its startup/server contract.
- Release-contract tests now require all three immutable artifacts and exact S3 VersionIds.
- Deployment-contract tests prove web bootstrap precedes Cognito, callback/logout URLs are derived from the deployed web origin, web finalization receives trusted backend outputs, and environment JSON cannot override those derived values.
- Exact-head GitHub Actions after publication is authoritative.

## Next product milestones

1. Run the protected deployment workflow and require the live smoke gate to pass against the real AWS environment.
2. Execute the controlled interactive vertical demo from `outputs.webOrigin`: Cognito sign-in -> BYOK -> Live View capture -> compile -> fresh test -> publish -> scheduled execution -> verification/history/email -> target-auth takeover/resume. The browser no longer asks for workflow, trace, run, or publish-version identifiers; the capture-to-compile path must prove the effect-verification bridge on a real page before broader targets are attempted.
3. Fix only concrete defects exposed by that environment; do not return to recovery micro-hardening without a demonstrated need.
4. If the vertical slice is repeatable, add a minimal authenticated live-cloud smoke using a dedicated test identity and short-lived credentials without retaining secret-bearing Actions artifacts.
5. Add Google federation/adapters only after the AWS vertical slice is demonstrated.

## Parked limitations

- Live OpenAI/SES/Cognito/AgentCore behavior still requires real AWS validation; deterministic CI is not live-cloud proof.
- The new anonymous deployment smoke validates reachability/configuration/auth boundaries, not an authenticated user lifecycle or AgentCore Browser/model execution.
- Capture structural verification is intentionally coarse and content-redacted. Dynamic pages whose post-action structure is unstable may fail verification and require a recapture or a future explicit user-authored effect assertion; do not silently weaken verification for them.
- Sensitive target-site runtime values still need a dedicated secret-resolution contract if a workflow needs secrets beyond the persisted Browser Profile.
- DynamoDB automation state and EventBridge Scheduler state cannot be atomically committed; current ordering fails closed.
- Capture-task duplicate suppression remains process-local while capture completion is globally durable; harden only if live Runtime replacement demonstrates a defect.
- Multi-artifact S3 release upload is not transactional. A partial upload creates no deployment manifest/authority and may leave orphan versions for lifecycle cleanup.
